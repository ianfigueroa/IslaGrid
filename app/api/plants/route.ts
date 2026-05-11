import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getServerSupabase } from "@/lib/supabase";

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

    for (const f of collection.features) {
      if (f.properties.kind !== "plant" && f.properties.kind !== "generator") continue;
      const key = (f.properties.name ?? "").toLowerCase().trim();
      const hit = latest.get(key);
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
