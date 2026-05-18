/**
 * Per-municipality outage history aggregates — powers the /m/[id] reliability
 * page (score, calendar, monthly chart, cause breakdown).
 *
 * Two data paths:
 *
 *  1. PREFERRED: `municipality_outage_daily` — pre-aggregated daily rollup
 *     written by ingestion/src/pipeline/aggregate_municipality_daily.py.
 *     Cheap to query, supports the full 12-month window.
 *
 *  2. FALLBACK: live aggregation from `outage_events` + `cause_predictions`.
 *     Used when the daily table is empty (first deploy, catch-up window) so
 *     the page renders something honest instead of empty zeros.
 *
 * "Reliability score" is the percentile rank of a muni's outage hours vs the
 * other 77 municipios in the same window. Higher = worse, to match
 * Lumatrack's convention ("less reliable than X% of Puerto Rico"). The
 * formula intentionally has no magic constants — the only knob is which
 * window the user picked.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type WindowKey = "30d" | "90d" | "365d";

export const WINDOW_DAYS: Record<WindowKey, number> = {
  "30d": 30,
  "90d": 90,
  "365d": 365,
};

/** Per-outage-hour estimated cost to the household: food spoilage + lost
 *  productivity. Pulled from FEMA + DOE outage-cost studies (mid-range). One
 *  place to edit if we want to revise the number. */
export const HOUSEHOLD_COST_PER_OUTAGE_HOUR_USD = 15;

export type CauseKey =
  | "generation"
  | "distribution"
  | "weather"
  | "planned"
  | "unknown";

export interface CauseBreakdown {
  generation: number;
  distribution: number;
  weather: number;
  planned: number;
  unknown: number;
}

export interface MunicipalityHistory {
  municipality_id: string;
  window: WindowKey;
  total_outages: number;
  total_hours: number;
  avg_duration_min: number;
  longest_hours: number;
  cause_hours: CauseBreakdown;
  /** Cause with the highest share. Returns "unknown" only when everything is unknown. */
  main_cause: CauseKey;
  /** [{date: 'YYYY-MM-DD', hours}], densely filled (zero rows included). */
  calendar: Array<{ date: string; hours: number }>;
  /** [{month: 'YYYY-MM', hours}], densely filled. */
  monthly: Array<{ month: string; hours: number }>;
  /** Percentile rank across all 78 munis. 0 = best, 100 = worst. */
  percentile: number;
  /** Mean outage hours across all munis with data in this window. Gives the
   *  user a reference point for whether their number is normal. */
  island_avg_hours: number;
  /** Median outage hours — more robust to outliers than the mean for the
   *  typical-household framing. */
  island_median_hours: number;
  /** Estimated annual household cost in USD. */
  annual_cost_usd: number;
  /** When the rollup table was last updated for this muni. null if served live. */
  daily_table_freshness_ts: string | null;
  /** "daily_rollup" | "live_aggregate" — UI can show a small subtle note when live. */
  source_path: "daily_rollup" | "live_aggregate" | "empty";
}

interface OutageEventRow {
  id: string;
  municipality_id: string | null;
  started_at: string;
  ended_at: string | null;
  kind: "planned" | "unplanned" | "restored" | "unknown";
}

interface CausePredictionRow {
  outage_event_id: string;
  cause: string;
}

interface DailyRow {
  municipality_id: string;
  day: string;
  outage_hours: number;
  outage_events: number;
  cause_generation_hours: number;
  cause_distribution_hours: number;
  cause_weather_hours: number;
  cause_planned_hours: number;
  cause_unknown_hours: number;
  updated_at: string;
}

/**
 * Top-level entry point used by the API route. Tries the daily rollup first;
 * falls back to live aggregation if the table is empty for this muni.
 */
export async function computeMunicipalityHistory(
  supabase: SupabaseClient,
  municipalityId: string,
  windowKey: WindowKey,
): Promise<MunicipalityHistory> {
  const days = WINDOW_DAYS[windowKey];
  const windowStart = startOfDay(daysAgo(days));
  const windowEnd = startOfDay(daysAgo(-1)); // tomorrow midnight, exclusive

  // ---- Try daily rollup ---------------------------------------------------
  const { data: dailyRows } = await supabase
    .from("municipality_outage_daily")
    .select(
      "municipality_id, day, outage_hours, outage_events, cause_generation_hours, cause_distribution_hours, cause_weather_hours, cause_planned_hours, cause_unknown_hours, updated_at",
    )
    .eq("municipality_id", municipalityId)
    .gte("day", toISODate(windowStart))
    .lt("day", toISODate(windowEnd));

  const rows = (dailyRows ?? []) as DailyRow[];
  if (rows.length > 0) {
    return rollupFromDaily(rows, municipalityId, windowKey, windowStart, supabase);
  }

  // ---- Fallback: live aggregate from outage_events -----------------------
  const sinceISO = windowStart.toISOString();
  const { data: eventRows } = await supabase
    .from("outage_events")
    .select("id, municipality_id, started_at, ended_at, kind")
    .eq("municipality_id", municipalityId)
    .gte("started_at", sinceISO);

  const events = (eventRows ?? []) as OutageEventRow[];
  if (events.length === 0) {
    return emptyHistory(municipalityId, windowKey);
  }

  const ids = events.map((e) => e.id);
  const { data: causeRows } = await supabase
    .from("cause_predictions")
    .select("outage_event_id, cause")
    .in("outage_event_id", ids);
  const causes = (causeRows ?? []) as CausePredictionRow[];
  const causeByEvent = new Map<string, string>();
  for (const c of causes) causeByEvent.set(c.outage_event_id, c.cause);

  return rollupFromEvents(events, causeByEvent, municipalityId, windowKey, windowStart);
}

export interface IslandStats {
  percentile: number;
  /** Mean outage hours across munis with data. */
  avg_hours: number;
  /** Median outage hours — more useful than mean when a few munis dominate. */
  median_hours: number;
}

/**
 * One scan, three numbers: the muni's percentile rank plus the island-wide
 * mean and median outage hours in the same window. Replaces the older
 * computeMuniPercentile (kept as a thin wrapper for back-compat).
 *
 * Standalone so the score card can call it without re-fetching everything
 * else. Returns percentile in [0, 100].
 */
export async function computeIslandStats(
  supabase: SupabaseClient,
  municipalityId: string,
  windowKey: WindowKey,
): Promise<IslandStats> {
  const days = WINDOW_DAYS[windowKey];
  const windowStart = startOfDay(daysAgo(days));

  // Try daily table first
  const { data: dailyHours } = await supabase
    .from("municipality_outage_daily")
    .select("municipality_id, outage_hours")
    .gte("day", toISODate(windowStart));

  const totals = new Map<string, number>();
  if (dailyHours && dailyHours.length > 0) {
    for (const r of dailyHours as Array<{ municipality_id: string; outage_hours: number }>) {
      totals.set(r.municipality_id, (totals.get(r.municipality_id) ?? 0) + r.outage_hours);
    }
  } else {
    const { data: events } = await supabase
      .from("outage_events")
      .select("municipality_id, started_at, ended_at")
      .gte("started_at", windowStart.toISOString());
    for (const e of (events ?? []) as Array<{
      municipality_id: string | null;
      started_at: string;
      ended_at: string | null;
    }>) {
      if (!e.municipality_id) continue;
      const hrs = eventHours(e.started_at, e.ended_at);
      totals.set(e.municipality_id, (totals.get(e.municipality_id) ?? 0) + hrs);
    }
  }

  const myHours = totals.get(municipalityId) ?? 0;
  if (totals.size < 2) {
    return { percentile: 0, avg_hours: round2(myHours), median_hours: round2(myHours) };
  }
  let worseOrEqualCount = 0;
  let sum = 0;
  const values: number[] = [];
  for (const v of totals.values()) {
    if (v <= myHours) worseOrEqualCount++;
    sum += v;
    values.push(v);
  }
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  const median =
    values.length % 2 === 0
      ? (values[mid - 1] + values[mid]) / 2
      : values[mid];
  return {
    percentile: Math.round((worseOrEqualCount / totals.size) * 100),
    avg_hours: round2(sum / totals.size),
    median_hours: round2(median),
  };
}

/** Back-compat wrapper. New code should call computeIslandStats. */
export async function computeMuniPercentile(
  supabase: SupabaseClient,
  municipalityId: string,
  windowKey: WindowKey,
): Promise<number> {
  return (await computeIslandStats(supabase, municipalityId, windowKey)).percentile;
}

// ============================================================================
// Internal helpers
// ============================================================================

function rollupFromDaily(
  rows: DailyRow[],
  municipalityId: string,
  windowKey: WindowKey,
  windowStart: Date,
  supabase: SupabaseClient,
): MunicipalityHistory {
  let totalHours = 0;
  let totalEvents = 0;
  const causeHours: CauseBreakdown = {
    generation: 0,
    distribution: 0,
    weather: 0,
    planned: 0,
    unknown: 0,
  };
  let longest = 0;
  let mostRecentUpdate = "";
  for (const r of rows) {
    totalHours += r.outage_hours;
    totalEvents += r.outage_events;
    causeHours.generation += r.cause_generation_hours;
    causeHours.distribution += r.cause_distribution_hours;
    causeHours.weather += r.cause_weather_hours;
    causeHours.planned += r.cause_planned_hours;
    causeHours.unknown += r.cause_unknown_hours;
    if (r.outage_hours > longest) longest = r.outage_hours;
    if (r.updated_at > mostRecentUpdate) mostRecentUpdate = r.updated_at;
  }

  const calendar = fillCalendar(
    rows.map((r) => ({ date: r.day, hours: r.outage_hours })),
    windowStart,
  );
  const monthly = monthlyFromDaily(calendar);
  const avgDurationMin = totalEvents > 0 ? (totalHours / totalEvents) * 60 : 0;

  return {
    municipality_id: municipalityId,
    window: windowKey,
    total_outages: totalEvents,
    total_hours: round2(totalHours),
    avg_duration_min: Math.round(avgDurationMin),
    longest_hours: round2(longest),
    cause_hours: roundCauseBreakdown(causeHours),
    main_cause: dominantCause(causeHours),
    calendar,
    monthly,
    // percentile is computed separately so the card can refresh independently
    percentile: 0,
    island_avg_hours: 0,
    island_median_hours: 0,
    annual_cost_usd: estimateAnnualCost(totalHours, windowKey),
    daily_table_freshness_ts: mostRecentUpdate || null,
    source_path: "daily_rollup",
  };
}

function rollupFromEvents(
  events: OutageEventRow[],
  causeByEvent: Map<string, string>,
  municipalityId: string,
  windowKey: WindowKey,
  windowStart: Date,
): MunicipalityHistory {
  // Group event hours by day + cause.
  const byDay = new Map<string, number>();
  const causeHours: CauseBreakdown = {
    generation: 0,
    distribution: 0,
    weather: 0,
    planned: 0,
    unknown: 0,
  };
  let totalHours = 0;
  let longest = 0;

  for (const e of events) {
    const hrs = eventHours(e.started_at, e.ended_at);
    totalHours += hrs;
    if (hrs > longest) longest = hrs;
    const dayKey = toISODate(new Date(e.started_at));
    byDay.set(dayKey, (byDay.get(dayKey) ?? 0) + hrs);

    const causeBucket = mapEventToCauseBucket(e, causeByEvent.get(e.id));
    causeHours[causeBucket] += hrs;
  }

  const dailyArr = Array.from(byDay.entries()).map(([date, hours]) => ({
    date,
    hours,
  }));
  const calendar = fillCalendar(dailyArr, windowStart);
  const monthly = monthlyFromDaily(calendar);
  const avgDurationMin = events.length > 0 ? (totalHours / events.length) * 60 : 0;

  return {
    municipality_id: municipalityId,
    window: windowKey,
    total_outages: events.length,
    total_hours: round2(totalHours),
    avg_duration_min: Math.round(avgDurationMin),
    longest_hours: round2(longest),
    cause_hours: roundCauseBreakdown(causeHours),
    main_cause: dominantCause(causeHours),
    calendar,
    monthly,
    percentile: 0,
    island_avg_hours: 0,
    island_median_hours: 0,
    annual_cost_usd: estimateAnnualCost(totalHours, windowKey),
    daily_table_freshness_ts: null,
    source_path: "live_aggregate",
  };
}

function emptyHistory(
  municipalityId: string,
  windowKey: WindowKey,
): MunicipalityHistory {
  const windowStart = startOfDay(daysAgo(WINDOW_DAYS[windowKey]));
  return {
    municipality_id: municipalityId,
    window: windowKey,
    total_outages: 0,
    total_hours: 0,
    avg_duration_min: 0,
    longest_hours: 0,
    cause_hours: {
      generation: 0,
      distribution: 0,
      weather: 0,
      planned: 0,
      unknown: 0,
    },
    main_cause: "unknown",
    calendar: fillCalendar([], windowStart),
    monthly: monthlyFromDaily(fillCalendar([], windowStart)),
    percentile: 0,
    island_avg_hours: 0,
    island_median_hours: 0,
    annual_cost_usd: 0,
    daily_table_freshness_ts: null,
    source_path: "empty",
  };
}

function mapEventToCauseBucket(
  event: OutageEventRow,
  predictedCause: string | undefined,
): CauseKey {
  if (event.kind === "planned") return "planned";
  switch (predictedCause) {
    case "weather":
    case "vegetation":
      return "weather";
    case "planned_maintenance":
      return "planned";
    case "generation_shortage":
      return "generation";
    case "transmission":
    case "distribution":
    case "equipment":
      return "distribution";
    default:
      return "unknown";
  }
}

function dominantCause(b: CauseBreakdown): CauseKey {
  const entries: Array<[CauseKey, number]> = [
    ["generation", b.generation],
    ["distribution", b.distribution],
    ["weather", b.weather],
    ["planned", b.planned],
    ["unknown", b.unknown],
  ];
  entries.sort((a, c) => c[1] - a[1]);
  // If everything is zero, return unknown.
  if (entries[0][1] === 0) return "unknown";
  return entries[0][0];
}

// Hard cap for events with `ended_at = NULL`. Most scrapers don't set the
// end time — they upsert one row per announcement and call it done — so
// without a cap, an open event from 90 days ago would claim 2,160 hours of
// "outage time" and inflate every rollup. 8h is a reasonable upper bound
// for the typical PR planned-work / aviso window; anything longer would
// realistically have generated a follow-up notice closing it out.
export const MAX_OPEN_EVENT_HOURS = 8;

function eventHours(started: string, ended: string | null): number {
  const start = new Date(started).getTime();
  if (ended) {
    const end = new Date(ended).getTime();
    return Math.max(0, (end - start) / (1000 * 60 * 60));
  }
  const elapsed = Math.max(0, (Date.now() - start) / (1000 * 60 * 60));
  return Math.min(elapsed, MAX_OPEN_EVENT_HOURS);
}

function fillCalendar(
  sparse: Array<{ date: string; hours: number }>,
  windowStart: Date,
): Array<{ date: string; hours: number }> {
  const byDate = new Map(sparse.map((r) => [r.date, r.hours]));
  const out: Array<{ date: string; hours: number }> = [];
  const today = startOfDay(new Date());
  const cursor = new Date(windowStart);
  while (cursor <= today) {
    const key = toISODate(cursor);
    out.push({ date: key, hours: byDate.get(key) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function monthlyFromDaily(
  daily: Array<{ date: string; hours: number }>,
): Array<{ month: string; hours: number }> {
  const byMonth = new Map<string, number>();
  for (const d of daily) {
    const month = d.date.slice(0, 7); // YYYY-MM
    byMonth.set(month, (byMonth.get(month) ?? 0) + d.hours);
  }
  return Array.from(byMonth.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, hours]) => ({ month, hours: round2(hours) }));
}

function estimateAnnualCost(totalHours: number, windowKey: WindowKey): number {
  const days = WINDOW_DAYS[windowKey];
  const annualHours = (totalHours / days) * 365;
  return Math.round(annualHours * HOUSEHOLD_COST_PER_OUTAGE_HOUR_USD);
}

function roundCauseBreakdown(b: CauseBreakdown): CauseBreakdown {
  return {
    generation: round2(b.generation),
    distribution: round2(b.distribution),
    weather: round2(b.weather),
    planned: round2(b.planned),
    unknown: round2(b.unknown),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
