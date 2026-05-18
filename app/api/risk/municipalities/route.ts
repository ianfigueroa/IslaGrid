import { NextResponse } from "next/server";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { augmentRiskBand, type RiskBand } from "@/lib/risk";

export const dynamic = "force-dynamic";
export const revalidate = 60;

interface RiskRow {
  municipality_id: string;
  ts: string;
  risk_score: number;
  band: RiskBand;
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

interface WeatherRow {
  municipality_id: string;
  wind_kph: number | null;
  gust_kph: number | null;
  precip_mm: number | null;
  alert_level: string | null;
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

    // Pull baseline risk + the latest weather row per muni in parallel. We
    // augment the persisted band with live weather here in the route (rather
    // than upstream in the ingestion job) so a fresh hurricane warning lifts
    // the map's "Risk" overlay within one /api/risk/municipalities request,
    // not after the next nightly batch.
    const since = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    const [riskRes, weatherRes] = await Promise.all([
      supabase
        .from("municipality_risk_latest")
        .select(
          "municipality_id, ts, risk_score, band, reasons, feature_freshness_s, source, model_version, ci_low, ci_high, forecast_cone_coverage_pct, nearest_storm_category, nearest_storm_id",
        ),
      supabase
        .from("weather_snapshots")
        .select("municipality_id, ts, wind_kph, gust_kph, precip_mm, alert_level")
        .gte("ts", since)
        .order("ts", { ascending: false })
        .limit(2000),
    ]);

    if (riskRes.error) throw new Error(riskRes.error.message);

    const weatherByMuni = new Map<string, WeatherRow>();
    for (const w of ((weatherRes.data ?? []) as Array<WeatherRow & { ts: string }>)) {
      if (!weatherByMuni.has(w.municipality_id)) {
        weatherByMuni.set(w.municipality_id, w);
      }
    }

    const items = ((riskRes.data ?? []) as RiskRow[]).map((row) => {
      const w = weatherByMuni.get(row.municipality_id);
      if (!w) return row;
      const aug = augmentRiskBand(row.band, w);
      if (aug.bumped_by === 0) return row;
      return {
        ...row,
        band: aug.band,
        reasons: [...row.reasons, ...aug.weather_reasons],
      };
    });

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
