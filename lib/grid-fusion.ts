import type { GridSnapshot, GridStatus } from "@/lib/supabase";

/**
 * Field-level fusion of partial grid snapshots from upstream sources.
 *
 * Background: genera-pr.com publishes generation / capacity / reserves but
 * not actual demand (it only publishes forecasts). lumapr.com publishes
 * demand + reserves but not full generation. Previously the API route picked
 * the freshest row from `source='islagrid-merged'` (a cron job that fuses
 * the two), then fell back to the freshest row from any source — which
 * meant a raw genera-pr.com row could win the fallback and serve a snapshot
 * with `current_demand_mw = null`, looking broken in the UI.
 *
 * This helper takes the latest row from each source and selects the right
 * field from each: supply-side fields come from Genera, demand-side fields
 * come from LUMA. A merged row, if present, fills in any remaining gaps.
 * Result: the UI matches genera-pr.com's published numbers within the
 * scraper's freshness window.
 */

/** A row from `grid_snapshots`, keyed by upstream source. */
export type SourceRows = {
  /** Latest row with source = 'genera-pr.com'. */
  genera?: GridSnapshot | null;
  /** Latest row with source = 'lumapr.com'. */
  luma?: GridSnapshot | null;
  /** Latest row with source = 'islagrid-merged' (output of the cron merge job). */
  merged?: GridSnapshot | null;
  /** Final fallback: latest row of any source. */
  anyLatest?: GridSnapshot | null;
};

/** Maximum age before a per-source row is considered stale (15 min). */
const STALE_MS = 15 * 60 * 1000;

function isFresh(row: GridSnapshot | null | undefined): row is GridSnapshot {
  if (!row?.ts) return false;
  return Date.now() - new Date(row.ts).getTime() < STALE_MS;
}

function pickNumber(
  field: keyof GridSnapshot,
  ...rows: Array<GridSnapshot | null | undefined>
): number | null {
  for (const r of rows) {
    if (!r) continue;
    const v = r[field];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

export interface FusionResult {
  snapshot: GridSnapshot | null;
  /** Per-field source attribution so the UI can show provenance. */
  source_map: Partial<Record<keyof GridSnapshot, string>>;
}

export function fuseGridSnapshots(rows: SourceRows): FusionResult {
  const { genera, luma, merged, anyLatest } = rows;

  // If literally nothing is present, return null so the API can return
  // `reason: ingest_pending`.
  const anyRow = genera ?? luma ?? merged ?? anyLatest ?? null;
  if (!anyRow) return { snapshot: null, source_map: {} };

  const source_map: Partial<Record<keyof GridSnapshot, string>> = {};

  // Supply-side: prefer Genera (authoritative), then merged, then luma.
  const supplySources = [genera, merged, luma, anyLatest];
  const demandSources = [luma, merged, genera, anyLatest];
  // Forecasts: LUMA only publishes peak forecast; Genera publishes next-hour.
  const peakSources = [luma, merged, genera, anyLatest];
  const nextHourSources = [genera, merged, luma, anyLatest];

  const total_generation_mw = pickNumber("total_generation_mw", ...supplySources);
  if (total_generation_mw !== null)
    source_map.total_generation_mw = sourceOf("total_generation_mw", supplySources);

  const available_capacity_mw = pickNumber("available_capacity_mw", ...supplySources);
  if (available_capacity_mw !== null)
    source_map.available_capacity_mw = sourceOf("available_capacity_mw", supplySources);

  const spinning_reserve_mw = pickNumber("spinning_reserve_mw", ...supplySources);
  if (spinning_reserve_mw !== null)
    source_map.spinning_reserve_mw = sourceOf("spinning_reserve_mw", supplySources);

  const operational_reserve_mw = pickNumber("operational_reserve_mw", ...supplySources);
  if (operational_reserve_mw !== null)
    source_map.operational_reserve_mw = sourceOf("operational_reserve_mw", supplySources);

  const current_demand_mw = pickNumber("current_demand_mw", ...demandSources);
  if (current_demand_mw !== null)
    source_map.current_demand_mw = sourceOf("current_demand_mw", demandSources);

  const next_hour_demand_mw = pickNumber("next_hour_demand_mw", ...nextHourSources);
  if (next_hour_demand_mw !== null)
    source_map.next_hour_demand_mw = sourceOf("next_hour_demand_mw", nextHourSources);

  const peak_demand_forecast_mw = pickNumber("peak_demand_forecast_mw", ...peakSources);
  if (peak_demand_forecast_mw !== null)
    source_map.peak_demand_forecast_mw = sourceOf("peak_demand_forecast_mw", peakSources);

  const peak_reserve_forecast_mw = pickNumber("peak_reserve_forecast_mw", ...peakSources);
  if (peak_reserve_forecast_mw !== null)
    source_map.peak_reserve_forecast_mw = sourceOf("peak_reserve_forecast_mw", peakSources);

  // Status flag: prefer the merged row's verdict (it's the only source that
  // knows BOTH supply and demand). Fall back to recomputing from reserves.
  const status: GridStatus = merged?.status
    ?? deriveStatus({ available_capacity_mw, current_demand_mw, operational_reserve_mw });
  source_map.status = merged?.status ? "islagrid-merged" : "derived";

  // Reasons: merge from all rows, dedupe.
  const status_reasons = Array.from(
    new Set([
      ...(merged?.status_reasons ?? []),
      ...(genera?.status_reasons ?? []),
      ...(luma?.status_reasons ?? []),
    ]),
  );

  // Freshness — pick the freshest ts of inputs we actually used.
  const candidates = [genera, luma, merged].filter(
    (r): r is GridSnapshot => Boolean(r?.ts),
  );
  const newest = candidates.length > 0
    ? candidates.sort((a, b) =>
        new Date(b.ts).getTime() - new Date(a.ts).getTime(),
      )[0]
    : anyRow;

  // source field summarizes provenance: "composite" when we mixed at least
  // two upstream sources, otherwise the single source we used.
  const distinct = new Set(Object.values(source_map).filter((v): v is string => Boolean(v)));
  distinct.delete("derived");
  const source = distinct.size > 1 ? "composite" : Array.from(distinct)[0] ?? newest.source;

  const stale = !isFresh(newest);

  const snapshot: GridSnapshot = {
    ts: newest.ts,
    current_demand_mw,
    next_hour_demand_mw,
    total_generation_mw,
    available_capacity_mw,
    spinning_reserve_mw,
    operational_reserve_mw,
    peak_demand_forecast_mw,
    peak_reserve_forecast_mw,
    status,
    status_reasons,
    source,
    source_stale: stale,
  };

  return { snapshot, source_map };
}

function sourceOf(
  field: keyof GridSnapshot,
  rows: Array<GridSnapshot | null | undefined>,
): string {
  for (const r of rows) {
    if (!r) continue;
    const v = r[field];
    if (typeof v === "number" && Number.isFinite(v)) return r.source;
  }
  return "unknown";
}

/**
 * Heuristic status when no merged row exists. Matches the merge_grid job's
 * thresholds so the API doesn't disagree with itself.
 */
function deriveStatus(args: {
  available_capacity_mw: number | null;
  current_demand_mw: number | null;
  operational_reserve_mw: number | null;
}): GridStatus {
  const { available_capacity_mw, current_demand_mw, operational_reserve_mw } = args;
  if (available_capacity_mw == null || current_demand_mw == null) return "unknown";
  const reserveMw = operational_reserve_mw
    ?? Math.max(0, available_capacity_mw - current_demand_mw);
  const reserveRatio = reserveMw / current_demand_mw;
  if (available_capacity_mw < current_demand_mw) return "critical";
  if (reserveRatio < 0.05) return "strained";
  if (reserveRatio < 0.12) return "watch";
  return "normal";
}
