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

  return NextResponse.json(
    {
      grid: grid.data,
      planned_work: plannedWork.data ?? [],
      outage_events: outageEvents.data ?? [],
      updates: updates.data ?? [],
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
