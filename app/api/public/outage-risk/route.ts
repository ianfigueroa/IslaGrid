import { NextResponse } from "next/server";
import { publicHandler } from "@/lib/public-api";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export const GET = publicHandler(
  { route: "/api/public/outage-risk" },
  async () => {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ items: [], reason: "supabase_unconfigured" });
    }
    const supa = getServerSupabase();
    const { data, error } = await supa
      .from("municipality_risk_latest")
      .select(
        "municipality_id, ts, risk_score, band, reasons, feature_freshness_s, source",
      );
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
