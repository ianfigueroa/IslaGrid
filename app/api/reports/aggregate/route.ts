import { NextResponse } from "next/server";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { cellToGeoJson } from "@/lib/h3";
import { confidenceBand } from "@/lib/reports";

export const dynamic = "force-dynamic";
export const revalidate = 60;

interface ClusterRow {
  h3: string;
  type: string;
  report_count: number;
  latest_ts: string;
}

interface ClusterFeatureProps {
  h3: string;
  count: number;
  band: "low" | "medium" | "high";
  by_type: Record<string, number>;
  latest_ts: string;
}

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({
      type: "FeatureCollection",
      features: [],
      reason: "supabase_unconfigured",
    });
  }

  const supa = getServerSupabase();
  const { data, error } = await supa
    .from("community_reports_public")
    .select("h3, type, report_count, latest_ts");

  if (error) {
    return NextResponse.json({
      type: "FeatureCollection",
      features: [],
      reason: "supabase_error",
      error: error.message,
    });
  }

  // The view exposes per-(h3, type) counts. Roll up to per-h3 for the map
  // layer, keeping the type breakdown as a sub-object on each feature.
  const byCell = new Map<string, ClusterFeatureProps>();
  for (const row of (data ?? []) as ClusterRow[]) {
    const cur = byCell.get(row.h3) ?? {
      h3: row.h3,
      count: 0,
      band: "low",
      by_type: {},
      latest_ts: row.latest_ts,
    };
    cur.count += row.report_count;
    cur.by_type[row.type] = (cur.by_type[row.type] ?? 0) + row.report_count;
    if (row.latest_ts > cur.latest_ts) cur.latest_ts = row.latest_ts;
    byCell.set(row.h3, cur);
  }

  const features = Array.from(byCell.values()).map((cell) => ({
    type: "Feature" as const,
    geometry: cellToGeoJson(cell.h3),
    properties: { ...cell, band: confidenceBand(cell.count) },
  }));

  return NextResponse.json(
    { type: "FeatureCollection" as const, features },
    {
      headers: {
        "Cache-Control":
          "public, max-age=30, s-maxage=60, stale-while-revalidate=120",
      },
    },
  );
}
