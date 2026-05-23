import { NextResponse } from "next/server";
import { publicHandler } from "@/lib/public-api";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { cellToGeoJson } from "@/lib/h3";
import { confidenceBand } from "@/lib/reports";

export const dynamic = "force-dynamic";

/**
 * Privacy floor: k-anonymity with k=5. Any H3 cell with fewer than 5 distinct
 * reports is suppressed entirely. This is stricter than the internal
 * `/api/reports/aggregate` route (which serves the live map) and intentional:
 * the public API can be scraped, so we want a higher privacy floor.
 */
const K_ANON_THRESHOLD = 5;

interface ClusterRow {
  h3: string;
  type: string;
  report_count: number;
  latest_ts: string;
}

export const GET = publicHandler(
  { route: "/api/public/community-reports/aggregate" },
  async () => {
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
      // Lift PostgREST's 1000-row default so the public aggregate isn't
      // silently truncated once enough H3 cells accumulate reports.
      .select("h3, type, report_count, latest_ts")
      .limit(20000);
    if (error) {
      // Don't echo the PostgREST error to clients; it tends to leak schema
      // details. Log it server-side for debugging.
      // eslint-disable-next-line no-console
      console.error("[public community-reports/aggregate] supabase read failed", error);
      return NextResponse.json(
        {
          type: "FeatureCollection",
          features: [],
          reason: "supabase_error",
        },
        { status: 502 },
      );
    }

    const byCell = new Map<
      string,
      { h3: string; count: number; by_type: Record<string, number>; latest_ts: string }
    >();
    for (const row of (data ?? []) as ClusterRow[]) {
      const cur = byCell.get(row.h3) ?? {
        h3: row.h3,
        count: 0,
        by_type: {},
        latest_ts: row.latest_ts,
      };
      cur.count += row.report_count;
      cur.by_type[row.type] = (cur.by_type[row.type] ?? 0) + row.report_count;
      if (row.latest_ts > cur.latest_ts) cur.latest_ts = row.latest_ts;
      byCell.set(row.h3, cur);
    }

    const features = Array.from(byCell.values())
      .filter((c) => c.count >= K_ANON_THRESHOLD)
      .map((c) => ({
        type: "Feature" as const,
        geometry: cellToGeoJson(c.h3),
        properties: {
          h3: c.h3,
          count: c.count,
          band: confidenceBand(c.count),
          latest_ts: c.latest_ts,
          // by_type omitted in the public response to reduce re-identification
          // surface area: count + cell is enough for downstream research.
        },
      }));

    return NextResponse.json(
      { type: "FeatureCollection", features, k_anonymity_threshold: K_ANON_THRESHOLD },
      {
        headers: {
          "Cache-Control":
            "public, max-age=60, s-maxage=120, stale-while-revalidate=300",
        },
      },
    );
  },
);
