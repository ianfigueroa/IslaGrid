import { NextResponse } from "next/server";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 300;

interface Row {
  municipality_id: string;
  ts: string;
  temp_c: number | null;
  wind_kph: number | null;
  gust_kph: number | null;
  precip_mm: number | null;
  prob_precip: number | null;
  alert_level: string | null;
}

/**
 * Latest weather snapshot per municipality. Used by the risk-feature pipeline
 * and any other consumer that needs a one-row-per-muni weather state. (The
 * map's old wind/rain overlays were removed; this endpoint stayed because the
 * per-muni risk inputs still need it.)
 *
 * Honest failure: if Supabase isn't configured or the query errors, we return
 * `{items: [], reason: "..."}` instead of fabricating values.
 */
export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ items: [], reason: "supabase_not_configured" });
  }
  try {
    const sb = getServerSupabase();
    // Two-step: pull recent rows (last 4h) then keep one per muni (the most
    // recent). Doing it in app code is simpler than a Postgres window function
    // call through the REST API and the row count stays tiny (~78 munis × 4h).
    const since = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    const { data, error } = await sb
      .from("weather_snapshots")
      .select(
        "municipality_id, ts, temp_c, wind_kph, gust_kph, precip_mm, prob_precip, alert_level",
      )
      .gte("ts", since)
      .order("ts", { ascending: false })
      .limit(2000);
    if (error) {
      return NextResponse.json({ items: [], reason: "supabase_error" });
    }
    const seen = new Set<string>();
    const items: Row[] = [];
    for (const row of (data ?? []) as Row[]) {
      if (seen.has(row.municipality_id)) continue;
      seen.add(row.municipality_id);
      items.push(row);
    }
    return NextResponse.json(
      {
        items,
        source: "weather_snapshots",
        fetched_at: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control":
            "public, max-age=120, s-maxage=300, stale-while-revalidate=600",
        },
      },
    );
  } catch {
    return NextResponse.json({ items: [], reason: "weather_latest_failed" });
  }
}
