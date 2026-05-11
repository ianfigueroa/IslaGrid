import { NextResponse } from "next/server";
import { DEMO_MODE } from "@/lib/demo";
import { getServerSupabase } from "@/lib/supabase";

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

const DEMO: PredictionRow[] = [
  {
    municipality_id: "san-juan",
    horizon: "6h",
    ts: new Date().toISOString(),
    probability: 0.38,
    confidence_band: "medium",
    top_factors: [
      { label: "Heavy precipitation expected", weight: 0.42 },
      { label: "Planned work nearby in next 24h", weight: 1 },
    ],
    model_version: "heuristic:v1-20260511",
    feature_freshness_s: 1800,
  },
  {
    municipality_id: "ponce",
    horizon: "6h",
    ts: new Date().toISOString(),
    probability: 0.61,
    confidence_band: "medium",
    top_factors: [
      { label: "Active NWS watch", weight: 1 },
      { label: "High wind forecast", weight: 0.55 },
    ],
    model_version: "heuristic:v1-20260511",
    feature_freshness_s: 1300,
  },
];

export async function GET() {
  if (DEMO_MODE) {
    return NextResponse.json({ items: DEMO, demo: true });
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
    return NextResponse.json({ items: (data ?? []) as PredictionRow[] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "prediction fetch failed";
    return NextResponse.json({ items: [] as PredictionRow[], error: message });
  }
}
