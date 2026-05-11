import { NextResponse } from "next/server";
import { DEMO_MODE } from "@/lib/demo";
import { getServerSupabase } from "@/lib/supabase";

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
}

const DEMO: RiskRow[] = [
  { municipality_id: "san-juan",  ts: new Date().toISOString(), risk_score: 36, band: "elevated", reasons: ["Weather is elevating risk", "Reserves are thinner than usual"], feature_freshness_s: 1800, source: "islagrid-heuristic" },
  { municipality_id: "bayamon",   ts: new Date().toISOString(), risk_score: 42, band: "elevated", reasons: ["Weather is elevating risk", "Planned work scheduled near this area"], feature_freshness_s: 2400, source: "islagrid-heuristic" },
  { municipality_id: "ponce",     ts: new Date().toISOString(), risk_score: 58, band: "high",     reasons: ["Severe weather forecast or active alert"], feature_freshness_s: 1200, source: "islagrid-heuristic" },
  { municipality_id: "mayaguez",  ts: new Date().toISOString(), risk_score: 22, band: "low",      reasons: ["Conditions stable"], feature_freshness_s: 1500, source: "islagrid-heuristic" },
  { municipality_id: "vieques",   ts: new Date().toISOString(), risk_score: 71, band: "high",     reasons: ["Severe weather forecast or active alert", "Repeated outage history in this area"], feature_freshness_s: 900, source: "islagrid-heuristic" },
  { municipality_id: "culebra",   ts: new Date().toISOString(), risk_score: 78, band: "severe",   reasons: ["Severe weather forecast or active alert", "Island grid is strained or critical"], feature_freshness_s: 1100, source: "islagrid-heuristic" },
];

export async function GET() {
  if (DEMO_MODE) {
    return NextResponse.json({ items: DEMO, demo: true });
  }
  try {
    const supabase = getServerSupabase();
    const { data, error } = await supabase
      .from("municipality_risk_latest")
      .select("municipality_id, ts, risk_score, band, reasons, feature_freshness_s, source");
    if (error) throw new Error(error.message);
    return NextResponse.json({ items: (data ?? []) as RiskRow[] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "risk fetch failed";
    return NextResponse.json({ items: [] as RiskRow[], error: message });
  }
}
