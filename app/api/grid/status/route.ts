import { NextResponse } from "next/server";
import {
  getServerSupabase,
  isSupabaseConfigured,
  type GridSnapshot,
} from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 60;

interface Payload {
  snapshot: GridSnapshot | null;
  reason?: "supabase_unconfigured" | "ingest_pending" | "supabase_error";
  error?: string;
}

export async function GET() {
  if (!isSupabaseConfigured()) {
    const body: Payload = { snapshot: null, reason: "supabase_unconfigured" };
    return NextResponse.json(body);
  }

  const supabase = getServerSupabase();

  // Prefer the authoritative `islagrid-merged` row. The component scrapers
  // (genera-pr.com, lumapr.com) each write their own partial grid_snapshots
  // rows — a raw genera-pr row has no current_demand_mw, so if it happened to
  // be the newest row a plain "latest" query would render "Status unknown".
  // merge_grid runs last each cycle and fuses the components into one complete
  // row; that's the one the public should see. Fall back to the latest
  // any-source row only when no merged row exists yet (e.g. first deploy).
  const merged = await supabase
    .from("grid_snapshots")
    .select("*")
    .eq("source", "islagrid-merged")
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle<GridSnapshot>();

  let { data, error } = merged;
  if (!error && !data) {
    const fallback = await supabase
      .from("grid_snapshots")
      .select("*")
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle<GridSnapshot>();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    const body: Payload = {
      snapshot: null,
      reason: "supabase_error",
      error: error.message,
    };
    return NextResponse.json(body, {
      headers: { "x-islagrid-source-error": "1" },
    });
  }

  const body: Payload = {
    snapshot: data,
    reason: data ? undefined : "ingest_pending",
  };
  return NextResponse.json(body, {
    headers: {
      "Cache-Control":
        "public, max-age=60, s-maxage=60, stale-while-revalidate=120",
    },
  });
}
