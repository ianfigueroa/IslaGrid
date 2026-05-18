import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getServerSupabase } from "@/lib/supabase";
import { curatedPlantsAsFeatures } from "@/lib/plants";

interface OsmFeature {
  type: "Feature";
  id: string;
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    kind: string;
    name?: string | null;
    operator?: string | null;
    fuel?: string | null;
    capacity_mw?: number | null;
    voltage?: string | null;
  };
}

interface OsmCollection {
  type: "FeatureCollection";
  features: OsmFeature[];
  fetched_at?: string;
}

export const dynamic = "force-dynamic";
export const revalidate = 600;

export async function GET() {
  let collection: OsmCollection = { type: "FeatureCollection", features: [] };
  try {
    const file = path.join(process.cwd(), "public", "geo", "osm-power-pr.geojson");
    collection = JSON.parse(await fs.readFile(file, "utf-8"));
  } catch {
    // file not committed yet — return an empty collection rather than 500.
  }

  // Splice in the curated plant list. OSM only carries scattered generator
  // nodes for PR, so without this seed the Plants layer would render almost
  // nothing recognizable. Curated entries win when an OSM feature shares the
  // same id (drop the OSM duplicate to avoid stacked dots).
  const curated = curatedPlantsAsFeatures();
  const curatedIds = new Set(curated.map((f) => f.id));
  collection = {
    ...collection,
    features: [
      ...curated as unknown as OsmFeature[],
      ...collection.features.filter((f) => !curatedIds.has(f.id)),
    ],
  };

  // Enrich plants with the latest generation snapshot when possible.
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && collection.features.length) {
    const supabase = getServerSupabase();
    const { data } = await supabase
      .from("generation_snapshots")
      .select("plant_id, mw, available_mw, ts")
      .order("ts", { ascending: false })
      .limit(500);

    const latest = new Map<string, { mw: number | null; available_mw: number | null; ts: string }>();
    for (const row of data ?? []) {
      if (!latest.has(row.plant_id)) {
        latest.set(row.plant_id, { mw: row.mw, available_mw: row.available_mw, ts: row.ts });
      }
    }

    // Try multiple join keys: normalized name, OSM id, and a stripped name
    // (drops parentheticals + common suffixes). Generation feed uses upstream
    // plant_ids that don't always match OSM `name` exactly.
    const normName = (s: string): string =>
      s
        .toLowerCase()
        .replace(/\([^)]*\)/g, "")
        .replace(/\b(power\s+plant|planta|central|cc|gt|thermal)\b/g, "")
        .replace(/\s+/g, " ")
        .trim();

    for (const f of collection.features) {
      if (f.properties.kind !== "plant" && f.properties.kind !== "generator") continue;
      const candidates = [
        (f.properties.name ?? "").toLowerCase().trim(),
        normName(f.properties.name ?? ""),
        f.id,
        String(f.id).replace(/^(node|way|relation)\//, ""),
      ].filter(Boolean);
      const hit = candidates.map((c) => latest.get(c)).find((h) => h);
      if (hit) {
        (f.properties as Record<string, unknown>).current_mw = hit.mw;
        (f.properties as Record<string, unknown>).current_ts = hit.ts;
      }
    }
  }

  return NextResponse.json(collection, {
    headers: {
      "Cache-Control": "public, max-age=600, s-maxage=600, stale-while-revalidate=3600",
    },
  });
}
