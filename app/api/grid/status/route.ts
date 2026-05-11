import { NextResponse } from "next/server";
import { getServerSupabase, type GridSnapshot } from "@/lib/supabase";
import { DEMO_MODE, demoSnapshot } from "@/lib/demo";

export const dynamic = "force-dynamic";
export const revalidate = 60;

export async function GET() {
  // Local dev / Vercel preview without real Supabase: serve demo data so the
  // UI can be evaluated. Production always points at a real Supabase URL.
  if (DEMO_MODE) {
    return NextResponse.json({ snapshot: demoSnapshot(), note: "demo" });
  }

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("grid_snapshots")
    .select("*")
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle<GridSnapshot>();

  if (error) {
    return NextResponse.json(
      { snapshot: null, error: error.message },
      { status: 200, headers: { "x-islagrid-source-error": "1" } },
    );
  }

  return NextResponse.json(
    { snapshot: data },
    {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=120",
      },
    },
  );
}
