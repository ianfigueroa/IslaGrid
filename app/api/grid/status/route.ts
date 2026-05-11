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
  const { data, error } = await supabase
    .from("grid_snapshots")
    .select("*")
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle<GridSnapshot>();

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
