import { NextResponse } from "next/server";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 60;

interface FeederRow {
  feeder_id: string;
  name: string | null;
  region: string | null;
  municipality_label: string | null;
  voltage_kv: number | null;
  load_mw: number | null;
  customers: number | null;
  status: string;
  predicted_load_shed: string;
  predicted_at: string | null;
  sectors: string | null;
  comments: string | null;
  geometry_geojson: GeoJSON.Geometry | null;
  ts: string;
}

interface FeederFeature {
  type: "Feature";
  id: string;
  geometry: GeoJSON.Geometry | null;
  properties: {
    feeder_id: string;
    kind: "outage" | "load_shed";
    name: string | null;
    region: string | null;
    municipality: string | null;
    voltage_kv: number | null;
    load_mw: number | null;
    customers: number | null;
    sectors: string | null;
    comments: string | null;
    ts: string;
    predicted_at: string | null;
  };
}

interface Payload {
  type: "FeatureCollection";
  features: FeederFeature[];
  reason?: "supabase_unconfigured" | "supabase_error";
  error?: string;
}

export async function GET() {
  if (!isSupabaseConfigured()) {
    const body: Payload = {
      type: "FeatureCollection",
      features: [],
      reason: "supabase_unconfigured",
    };
    return NextResponse.json(body);
  }

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("aeepr_feeder_latest")
    .select(
      "feeder_id, name, region, municipality_label, voltage_kv, load_mw, customers, status, predicted_load_shed, predicted_at, sectors, comments, geometry_geojson, ts",
    )
    .or("status.eq.SI,predicted_load_shed.eq.SI")
    .limit(2000);

  if (error) {
    const body: Payload = {
      type: "FeatureCollection",
      features: [],
      reason: "supabase_error",
      error: error.message,
    };
    return NextResponse.json(body, { status: 500 });
  }

  const features: FeederFeature[] = ((data ?? []) as FeederRow[]).map((r) => ({
    type: "Feature",
    id: r.feeder_id,
    geometry: r.geometry_geojson,
    properties: {
      feeder_id: r.feeder_id,
      kind: r.status === "SI" ? "outage" : "load_shed",
      name: r.name,
      region: r.region,
      municipality: r.municipality_label,
      voltage_kv: r.voltage_kv,
      load_mw: r.load_mw,
      customers: r.customers,
      sectors: r.sectors,
      comments: r.comments,
      ts: r.ts,
      predicted_at: r.predicted_at,
    },
  }));

  const body: Payload = { type: "FeatureCollection", features };
  return NextResponse.json(body, {
    headers: {
      "Cache-Control":
        "public, max-age=60, s-maxage=60, stale-while-revalidate=120",
    },
  });
}
