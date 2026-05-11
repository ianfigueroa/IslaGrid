import { NextResponse } from "next/server";
import { publicHandler } from "@/lib/public-api";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export const GET = publicHandler(
  { route: "/api/public/reserves/current" },
  async () => {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ reserves: null, reason: "supabase_unconfigured" });
    }
    const supa = getServerSupabase();
    const { data, error } = await supa
      .from("grid_snapshots")
      .select(
        "ts, spinning_reserve_mw, operational_reserve_mw, peak_reserve_forecast_mw, available_capacity_mw, current_demand_mw, source",
      )
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      return NextResponse.json(
        { reserves: null, reason: "supabase_error", error: error.message },
        { status: 502 },
      );
    }
    return NextResponse.json({
      reserves: data,
      reason: data ? undefined : "ingest_pending",
    });
  },
);
