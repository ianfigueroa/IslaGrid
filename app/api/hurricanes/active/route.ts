import { NextResponse } from "next/server";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 600;

interface StormRow {
  storm_id: string;
  storm_name: string | null;
  basin: string;
  forecast_made_at: string;
  category: number | null;
  max_wind_kt: number | null;
  min_pressure_mb: number | null;
  track_geojson: GeoJSON.Geometry | null;
  cone_geojson: GeoJSON.Geometry | null;
}

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({
      type: "FeatureCollection",
      features: [],
      reason: "supabase_unconfigured",
    });
  }
  try {
    const supa = getServerSupabase();
    const { data, error } = await supa
      .from("hurricane_active_latest")
      .select(
        "storm_id, storm_name, basin, forecast_made_at, category, max_wind_kt, min_pressure_mb, track_geojson, cone_geojson",
      );
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as StormRow[];
    const features: GeoJSON.Feature[] = [];
    for (const r of rows) {
      if (r.cone_geojson) {
        features.push({
          type: "Feature",
          id: `${r.storm_id}-cone`,
          geometry: r.cone_geojson,
          properties: {
            kind: "cone",
            storm_id: r.storm_id,
            storm_name: r.storm_name,
            category: r.category,
            max_wind_kt: r.max_wind_kt,
            forecast_made_at: r.forecast_made_at,
          },
        });
      }
      if (r.track_geojson) {
        features.push({
          type: "Feature",
          id: `${r.storm_id}-track`,
          geometry: r.track_geojson,
          properties: {
            kind: "track",
            storm_id: r.storm_id,
            storm_name: r.storm_name,
            category: r.category,
          },
        });
      }
    }
    return NextResponse.json(
      {
        type: "FeatureCollection",
        features,
        source: "nhc-hurdat",
        reason: rows.length === 0 ? "no_active_storms" : undefined,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=600, s-maxage=600, stale-while-revalidate=1800",
        },
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "fetch failed";
    return NextResponse.json({
      type: "FeatureCollection",
      features: [],
      reason: "supabase_error",
      error: msg,
    });
  }
}
