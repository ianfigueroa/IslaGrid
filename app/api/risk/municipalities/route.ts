import { NextResponse } from "next/server";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 60;

interface RiskRow {
  municipality_id: string;
  ts: string;
  risk_score: number;
  band: "low" | "elevated" | "high" | "severe" | "unknown";
  reasons: string[];
  feature_freshness_s: number;
  source: string;
  model_version?: string | null;
  ci_low?: number | null;
  ci_high?: number | null;
  forecast_cone_coverage_pct?: number | null;
  nearest_storm_category?: number | null;
  nearest_storm_id?: string | null;
}

interface Payload {
  items: RiskRow[];
  reason?: "supabase_unconfigured" | "ingest_pending" | "supabase_error";
  error?: string;
}

export async function GET() {
  if (!isSupabaseConfigured()) {
    const body: Payload = { items: [], reason: "supabase_unconfigured" };
    return NextResponse.json(body);
  }
  try {
    const supabase = getServerSupabase();
    const { data, error } = await supabase
      .from("municipality_risk_latest")
      .select(
        "municipality_id, ts, risk_score, band, reasons, feature_freshness_s, source, model_version, ci_low, ci_high, forecast_cone_coverage_pct, nearest_storm_category, nearest_storm_id",
      );
    if (error) throw new Error(error.message);
    const items = (data ?? []) as RiskRow[];
    const body: Payload = {
      items,
      reason: items.length === 0 ? "ingest_pending" : undefined,
    };
    return NextResponse.json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "risk fetch failed";
    const body: Payload = {
      items: [],
      reason: "supabase_error",
      error: message,
    };
    return NextResponse.json(body);
  }
}
