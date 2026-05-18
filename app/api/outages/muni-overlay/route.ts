import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";
import {
  LUMA_REGIONS,
  MUNI_TO_REGION,
  normalizeRegionName,
  type LumaRegion,
} from "@/lib/luma-regions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Same cache window as /api/outages/summary so the banner, panel, and this
// overlay all step in lockstep.
export const revalidate = 30;

interface LumaRegionRow {
  region_name: string;
  customers_affected: number | null;
  ts: string;
}

interface MuniFeature {
  type: "Feature";
  id: string;
  geometry: GeoJSON.Geometry;
  properties: {
    id: string;
    name: string;
    region: LumaRegion;
    region_customers_out: number;
    /** Per-muni share = region total ÷ # of munis in region. Honest coarse split. */
    muni_customers_out_estimate: number;
  };
}

interface Payload {
  type: "FeatureCollection";
  features: MuniFeature[];
  fetched_at: string;
  source: "luma-region-smear";
  total_customers: number;
  reason?: "supabase_unconfigured" | "supabase_error" | "no_data";
  error?: string;
}

function emptyPayload(reason: Payload["reason"]): Payload {
  return {
    type: "FeatureCollection",
    features: [],
    fetched_at: new Date().toISOString(),
    source: "luma-region-smear",
    total_customers: 0,
    reason,
  };
}

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(emptyPayload("supabase_unconfigured"));
  }
  try {
    const supabase = getServerSupabase();
    const { data, error } = await supabase
      .from("luma_outage_latest")
      .select("region_name, customers_affected, ts");
    if (error) throw new Error(error.message);

    const customersByRegion = new Map<LumaRegion, number>();
    let newestTs = "";
    let total = 0;
    for (const row of (data ?? []) as LumaRegionRow[]) {
      const region = normalizeRegionName(row.region_name);
      if (!region) continue;
      const customers =
        typeof row.customers_affected === "number" ? row.customers_affected : 0;
      customersByRegion.set(
        region,
        (customersByRegion.get(region) ?? 0) + customers,
      );
      total += customers;
      if (row.ts > newestTs) newestTs = row.ts;
    }

    if (total === 0) {
      return NextResponse.json(
        { ...emptyPayload("no_data"), fetched_at: newestTs || new Date().toISOString() },
        {
          headers: {
            "Cache-Control":
              "public, max-age=30, s-maxage=30, stale-while-revalidate=60",
          },
        },
      );
    }

    const file = path.join(
      process.cwd(),
      "public",
      "geo",
      "pr-municipalities.geojson",
    );
    const raw = await fs.readFile(file, "utf8");
    const fc = JSON.parse(raw) as {
      features: Array<{
        type: "Feature";
        geometry: GeoJSON.Geometry;
        properties: { id: string; name: string };
      }>;
    };

    const features: MuniFeature[] = [];
    for (const f of fc.features) {
      const region = MUNI_TO_REGION[f.properties.id];
      if (!region) continue;
      const regionTotal = customersByRegion.get(region) ?? 0;
      if (regionTotal <= 0) continue;
      const regionMuniCount = LUMA_REGIONS[region].length;
      features.push({
        type: "Feature",
        id: f.properties.id,
        geometry: f.geometry,
        properties: {
          id: f.properties.id,
          name: f.properties.name,
          region,
          region_customers_out: regionTotal,
          muni_customers_out_estimate: Math.round(regionTotal / regionMuniCount),
        },
      });
    }

    const body: Payload = {
      type: "FeatureCollection",
      features,
      fetched_at: newestTs || new Date().toISOString(),
      source: "luma-region-smear",
      total_customers: total,
    };
    return NextResponse.json(body, {
      headers: {
        "Cache-Control":
          "public, max-age=30, s-maxage=30, stale-while-revalidate=60",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "muni overlay failed";
    return NextResponse.json(
      { ...emptyPayload("supabase_error"), error: message },
      { status: 500 },
    );
  }
}
