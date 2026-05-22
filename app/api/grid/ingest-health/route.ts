import { NextResponse } from "next/server";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 30;

/**
 * Per-pipeline freshness probe used by the freshness-check workflow and by
 * the operator dashboard. For each ingest pipeline we look at the timestamp
 * of its newest row in its primary output table and compare against an
 * expected cadence. Status:
 *   - "ok"     — newest row is younger than expected_cadence_minutes
 *   - "lagging" — between 1× and 2× expected (workflow may be running slow)
 *   - "stale"   — older than 2× expected (workflow probably failed)
 *   - "missing" — no rows at all (pipeline never ran or table missing)
 *
 * Rationale: the existing freshness-check workflow only looks at
 * `/api/grid/status.snapshot.ts`, so a Genera-only outage hides behind a
 * fresh LUMA row, a stalled outage_events run goes unnoticed, etc. This
 * endpoint surfaces each pipeline independently so silent failures become
 * loud.
 */

type Status = "ok" | "lagging" | "stale" | "missing";

interface Probe {
  pipeline: string;
  table: string;
  source_filter?: string;
  expected_cadence_minutes: number;
}

interface PipelineHealth {
  pipeline: string;
  table: string;
  last_row_at: string | null;
  age_seconds: number | null;
  expected_cadence_minutes: number;
  status: Status;
}

const PROBES: Probe[] = [
  { pipeline: "genera-pr", table: "grid_snapshots", source_filter: "genera-pr.com", expected_cadence_minutes: 10 },
  { pipeline: "luma-system-overview", table: "grid_snapshots", source_filter: "lumapr.com", expected_cadence_minutes: 10 },
  { pipeline: "merge-grid", table: "grid_snapshots", source_filter: "islagrid-merged", expected_cadence_minutes: 15 },
  { pipeline: "luma-outage-map", table: "region_outages", expected_cadence_minutes: 15 },
  { pipeline: "official-updates", table: "official_updates", expected_cadence_minutes: 120 },
  { pipeline: "nws-weather", table: "weather_forecasts", expected_cadence_minutes: 120 },
  { pipeline: "nws-alerts", table: "weather_alerts", expected_cadence_minutes: 120 },
  { pipeline: "predict-outage", table: "outage_predictions", source_filter: "islagrid-model", expected_cadence_minutes: 60 },
];

function classify(ageSeconds: number | null, cadenceMinutes: number): Status {
  if (ageSeconds === null) return "missing";
  const cadenceSeconds = cadenceMinutes * 60;
  if (ageSeconds <= cadenceSeconds) return "ok";
  if (ageSeconds <= cadenceSeconds * 2) return "lagging";
  return "stale";
}

async function probeOne(
  supabase: ReturnType<typeof getServerSupabase>,
  p: Probe,
): Promise<PipelineHealth> {
  let q = supabase.from(p.table).select("ts").order("ts", { ascending: false }).limit(1);
  if (p.source_filter) q = q.eq("source", p.source_filter);
  const { data, error } = await q.maybeSingle<{ ts: string }>();
  if (error) {
    return {
      pipeline: p.pipeline,
      table: p.table,
      last_row_at: null,
      age_seconds: null,
      expected_cadence_minutes: p.expected_cadence_minutes,
      status: "missing",
    };
  }
  const ts = data?.ts ?? null;
  const ageSeconds = ts ? Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000)) : null;
  return {
    pipeline: p.pipeline,
    table: p.table,
    last_row_at: ts,
    age_seconds: ageSeconds,
    expected_cadence_minutes: p.expected_cadence_minutes,
    status: classify(ageSeconds, p.expected_cadence_minutes),
  };
}

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { pipelines: [], reason: "supabase_unconfigured" },
      { status: 200 },
    );
  }
  const supabase = getServerSupabase();
  const pipelines = await Promise.all(PROBES.map((p) => probeOne(supabase, p)));
  const worst = pipelines.reduce<Status>((acc, p) => {
    const rank: Record<Status, number> = { ok: 0, lagging: 1, stale: 2, missing: 3 };
    return rank[p.status] > rank[acc] ? p.status : acc;
  }, "ok");
  return NextResponse.json(
    { pipelines, overall: worst, checked_at: new Date().toISOString() },
    { headers: { "Cache-Control": "public, max-age=30, s-maxage=30, stale-while-revalidate=120" } },
  );
}
