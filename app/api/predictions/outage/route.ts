import { NextResponse } from "next/server";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 60;

interface PredictionRow {
  municipality_id: string;
  horizon: "1h" | "6h" | "12h" | "24h";
  ts: string;
  probability: number;
  confidence_band: "low" | "medium" | "high";
  top_factors: Array<{ label: string; weight: number }>;
  model_version: string;
  feature_freshness_s: number;
}

interface Payload {
  items: PredictionRow[];
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
      .from("outage_predictions_latest")
      .select(
        "municipality_id, horizon, ts, probability, confidence_band, top_factors, model_version, feature_freshness_s",
      )
      .eq("horizon", "6h");
    if (error) throw new Error(error.message);
    const items = (data ?? []) as PredictionRow[];
    const body: Payload = {
      items,
      reason: items.length === 0 ? "ingest_pending" : undefined,
    };
    return NextResponse.json(body);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "prediction fetch failed";
    const body: Payload = {
      items: [],
      reason: "supabase_error",
      error: message,
    };
    return NextResponse.json(body);
  }
}
