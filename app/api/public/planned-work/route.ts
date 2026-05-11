import { NextResponse } from "next/server";
import { publicHandler } from "@/lib/public-api";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export const GET = publicHandler(
  { route: "/api/public/planned-work" },
  async () => {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ items: [], reason: "supabase_unconfigured" });
    }
    const supa = getServerSupabase();
    const { data, error } = await supa
      .from("planned_work")
      .select(
        "id, municipality_id, area, work_type, start_ts, end_ts, possible_interruption, source_url",
      )
      .gte("end_ts", new Date().toISOString())
      .order("start_ts", { ascending: true })
      .limit(500);
    if (error) {
      return NextResponse.json(
        { items: [], reason: "supabase_error", error: error.message },
        { status: 502 },
      );
    }
    const items = data ?? [];
    return NextResponse.json({
      items,
      count: items.length,
      reason: items.length === 0 ? "ingest_pending" : undefined,
    });
  },
);
