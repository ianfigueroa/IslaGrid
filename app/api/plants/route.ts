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

  // Enrich plants with the latest reading from plant_snapshots (Genera PR's
  // per-station MW feed). generation_snapshots used to be the join target but
  // that table is now empty — plant_snapshots is the live source.
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && collection.features.length) {
    const supabase = getServerSupabase();
    const { data } = await supabase
      .from("plant_snapshots")
      .select("plant_name, category, output_mw, ts")
      .order("ts", { ascending: false })
      .limit(500);

    const normName = (s: string): string =>
      s
        .toLowerCase()
        .replace(/\([^)]*\)/g, "")
        .replace(/\b(power\s+plant|planta|central|cc|gt|thermal)\b/g, "")
        .replace(/\s+/g, " ")
        .trim();

    // plant_snapshots is "one row per category per plant per scrape" — sum
    // categories so a multi-unit plant (e.g. San Juan base + peak) reports
    // its combined output. Keep the newest ts as the freshness anchor.
    const latest = new Map<
      string,
      { mw: number; ts: string; category: string | null }
    >();
    for (const row of data ?? []) {
      const key = normName(row.plant_name ?? "");
      if (!key) continue;
      const mw = typeof row.output_mw === "number" ? row.output_mw : Number(row.output_mw);
      if (!Number.isFinite(mw)) continue;
      const existing = latest.get(key);
      if (existing && existing.ts > row.ts) continue; // older row → skip
      if (existing && existing.ts === row.ts) {
        existing.mw += mw;
        continue;
      }
      latest.set(key, { mw, ts: row.ts, category: row.category ?? null });
    }

    for (const f of collection.features) {
      if (f.properties.kind !== "plant" && f.properties.kind !== "generator") continue;
      const candidates = [
        normName(f.properties.name ?? ""),
        (f.properties.name ?? "").toLowerCase().trim(),
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
