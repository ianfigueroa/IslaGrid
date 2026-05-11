/**
 * Server-only data loader for /m/[id] scorecard pages.
 *
 * Aggregates everything we know about a municipality from real ingested data.
 * When Supabase is unconfigured or empty, fields are null — the UI renders
 * "no data yet" rather than fabricating numbers.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { getServerSupabase, isSupabaseConfigured } from "./supabase";

export interface MunicipalityBasics {
  id: string;
  name: string;
  fips: string | null;
  population: number | null;
}

export interface RiskInfo {
  score: number;
  band: "low" | "elevated" | "high" | "severe" | "unknown";
  reasons: string[];
  ts: string;
}

export interface PredictionInfo {
  horizon: "1h" | "6h" | "12h" | "24h";
  probability: number;
  confidence_band: "low" | "medium" | "high";
  top_factors: Array<{ label: string; weight: number }>;
  model_version: string;
  ts: string;
}

export interface PlannedWorkInfo {
  id: string;
  area: string | null;
  work_type: string | null;
  start_ts: string | null;
  end_ts: string | null;
  possible_interruption: boolean | null;
}

export interface OutageInfo {
  id: string;
  started_at: string;
  ended_at: string | null;
  kind: "planned" | "unplanned" | "restored" | "unknown";
  snippet: string | null;
}

export interface RiskHistoryPoint {
  ts: string;
  score: number;
  band: RiskInfo["band"];
}

export interface VulnerabilityInfo {
  total_score: number;
  confidence: "low" | "medium" | "high";
  reasons: string[];
  sources: string[];
}

export interface Scorecard {
  basics: MunicipalityBasics;
  risk: RiskInfo | null;
  prediction6h: PredictionInfo | null;
  plannedWork: PlannedWorkInfo[];
  recentOutages: OutageInfo[];
  reportCount24h: number;
  history30d: RiskHistoryPoint[];
  solarPotentialKw: number | null;
  vulnerability: VulnerabilityInfo | null;
  reason?: "supabase_unconfigured";
}

let cachedFeatures: MunicipalityBasics[] | null = null;

async function loadFeatures(): Promise<MunicipalityBasics[]> {
  if (cachedFeatures) return cachedFeatures;
  const file = path.join(
    process.cwd(),
    "public",
    "geo",
    "pr-municipalities.geojson",
  );
  const raw = await fs.readFile(file, "utf8");
  const fc = JSON.parse(raw) as {
    features: Array<{
      properties: {
        id: string;
        name: string;
        fips: string | null;
        population: number | null;
      };
    }>;
  };
  cachedFeatures = fc.features.map((f) => f.properties);
  return cachedFeatures;
}

export async function listMunicipalities(): Promise<MunicipalityBasics[]> {
  const all = await loadFeatures();
  return [...all].sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadScorecard(id: string): Promise<Scorecard | null> {
  const features = await loadFeatures();
  const basics = features.find((p) => p.id === id || p.fips === id);
  if (!basics) return null;

  if (!isSupabaseConfigured()) {
    return {
      basics,
      risk: null,
      prediction6h: null,
      plannedWork: [],
      recentOutages: [],
      reportCount24h: 0,
      history30d: [],
      solarPotentialKw: null,
      vulnerability: null,
      reason: "supabase_unconfigured",
    };
  }

  const supa = getServerSupabase();
  const muniId = basics.id;
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sinceNow = new Date().toISOString();

  // Run the independent queries in parallel.
  const [
    riskLatest,
    prediction,
    planned,
    outages,
    history,
    solar,
    vulnerability,
  ] = await Promise.all([
    supa
      .from("municipality_risk_latest")
      .select("risk_score, band, reasons, ts")
      .eq("municipality_id", muniId)
      .maybeSingle(),
    supa
      .from("outage_predictions_latest")
      .select("horizon, probability, confidence_band, top_factors, model_version, ts")
      .eq("municipality_id", muniId)
      .eq("horizon", "6h")
      .maybeSingle(),
    supa
      .from("planned_work")
      .select("id, area, work_type, start_ts, end_ts, possible_interruption")
      .eq("municipality_id", muniId)
      .gte("end_ts", sinceNow)
      .order("start_ts", { ascending: true })
      .limit(10),
    supa
      .from("outage_events")
      .select("id, started_at, ended_at, kind, snippet")
      .eq("municipality_id", muniId)
      .order("started_at", { ascending: false })
      .limit(10),
    supa
      .from("municipality_risk_snapshots")
      .select("ts, risk_score, band")
      .eq("municipality_id", muniId)
      .gte("ts", since30d)
      .order("ts", { ascending: true })
      .limit(720),
    supa
      .from("nrel_pvrdb_pr")
      .select("kw_potential", { count: "exact", head: false })
      .limit(1),
    supa
      .from("infra_vulnerability_scores")
      .select("total_score, confidence, reasons, sources")
      .eq("municipality_id", muniId)
      .maybeSingle(),
  ]);

  // Report count via the public aggregate view, scoped to this municipality
  // by the `municipality_id` column added in migration 0014. Reports inserted
  // before that migration have municipality_id NULL and are excluded.
  let reportCount24h = 0;
  try {
    const { data: agg } = await supa
      .from("community_reports_public")
      .select("report_count")
      .eq("municipality_id", muniId);
    reportCount24h = (agg ?? []).reduce(
      (s, r) => s + Number(r.report_count ?? 0),
      0,
    );
  } catch {
    reportCount24h = 0;
  }

  const solarPotentialKw =
    solar.data && solar.data.length > 0
      ? Number(solar.data[0]?.kw_potential ?? 0)
      : null;

  return {
    basics,
    risk: riskLatest.data
      ? {
          score: Number(riskLatest.data.risk_score),
          band: riskLatest.data.band as RiskInfo["band"],
          reasons: (riskLatest.data.reasons as string[]) ?? [],
          ts: riskLatest.data.ts as string,
        }
      : null,
    prediction6h: prediction.data
      ? {
          horizon: prediction.data.horizon as PredictionInfo["horizon"],
          probability: Number(prediction.data.probability),
          confidence_band: prediction.data.confidence_band as PredictionInfo["confidence_band"],
          top_factors: (prediction.data.top_factors as PredictionInfo["top_factors"]) ?? [],
          model_version: prediction.data.model_version as string,
          ts: prediction.data.ts as string,
        }
      : null,
    plannedWork: (planned.data ?? []) as PlannedWorkInfo[],
    recentOutages: (outages.data ?? []) as OutageInfo[],
    reportCount24h,
    history30d: ((history.data ?? []) as Array<{
      ts: string;
      risk_score: number;
      band: RiskInfo["band"];
    }>).map((r) => ({ ts: r.ts, score: r.risk_score, band: r.band })),
    solarPotentialKw,
    vulnerability: vulnerability.data
      ? {
          total_score: Number(vulnerability.data.total_score),
          confidence: vulnerability.data.confidence as VulnerabilityInfo["confidence"],
          reasons: (vulnerability.data.reasons as string[]) ?? [],
          sources: (vulnerability.data.sources as string[]) ?? [],
        }
      : null,
  };
}
