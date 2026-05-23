import { NextResponse } from "next/server";
import { publicHandler } from "@/lib/public-api";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { GridSnapshot } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export const GET = publicHandler({ route: "/api/public/grid-status" }, async () => {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ snapshot: null, reason: "supabase_unconfigured" });
  }
  const supa = getServerSupabase();
  const { data, error } = await supa
    .from("grid_snapshots")
    .select(
      "ts, current_demand_mw, next_hour_demand_mw, total_generation_mw, available_capacity_mw, spinning_reserve_mw, operational_reserve_mw, peak_demand_forecast_mw, peak_reserve_forecast_mw, status, status_reasons, source, source_stale",
    )
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle<GridSnapshot>();

  if (error) {
    // eslint-disable-next-line no-console
    console.error("[public/grid-status] supabase read failed", error);
    return NextResponse.json(
      { snapshot: null, reason: "supabase_error" },
      { status: 502 },
    );
  }
  return NextResponse.json({
    snapshot: data,
    reason: data ? undefined : "ingest_pending",
  });
});
