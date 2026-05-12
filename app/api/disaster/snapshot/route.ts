import { NextResponse } from "next/server";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 60;

/**
 * Single endpoint feeding /disaster — bundled to minimize requests during
 * limited connectivity. Returns the bare minimum: grid status, last 48h
 * outage events, current planned work, last 10 official updates. Everything
 * else is computed client-side from this payload.
 */
export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({
      grid: null,
      planned_work: [],
      outage_events: [],
      updates: [],
      reason: "supabase_unconfigured",
      ts: new Date().toISOString(),
    });
  }

  const supa = getServerSupabase();
  const since48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  const [grid, plannedWork, outageEvents, updates] = await Promise.all([
    supa
      .from("grid_snapshots")
      .select(
        "ts, current_demand_mw, total_generation_mw, operational_reserve_mw, status, status_reasons, source",
      )
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supa
      .from("planned_work")
      .select(
        "id, municipality_id, area, work_type, start_ts, end_ts, possible_interruption",
      )
      .gte("end_ts", now)
      .order("start_ts", { ascending: true })
      .limit(50),
    supa
      .from("outage_events")
      .select("id, municipality_id, started_at, ended_at, kind, snippet")
      .gte("started_at", since48h)
      .order("started_at", { ascending: false })
      .limit(100),
    supa
      .from("official_updates")
      .select("id, ts, source, category, text, url")
      .gte("ts", since48h)
      .order("ts", { ascending: false })
      .limit(20),
  ]);

  // Per-section reason fields so the offline UI knows whether a missing
  // section is "ingest_pending" (empty), "supabase_error" (query failed),
  // or simply "no recent rows in the window".
  const reasonFor = (
    err: { message?: string } | null,
    rows: unknown[] | null,
  ): string | undefined => {
    if (err) return "supabase_error";
    if (!rows || rows.length === 0) return "ingest_pending";
    return undefined;
  };

  return NextResponse.json(
    {
      grid: grid.data,
      grid_reason: grid.error
        ? "supabase_error"
        : grid.data
          ? undefined
          : "ingest_pending",
      planned_work: plannedWork.data ?? [],
      planned_work_reason: reasonFor(plannedWork.error, plannedWork.data),
      outage_events: outageEvents.data ?? [],
      outage_events_reason: reasonFor(outageEvents.error, outageEvents.data),
      updates: updates.data ?? [],
      updates_reason: reasonFor(updates.error, updates.data),
      ts: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control":
          "public, max-age=60, s-maxage=120, stale-while-revalidate=600",
      },
    },
  );
}
