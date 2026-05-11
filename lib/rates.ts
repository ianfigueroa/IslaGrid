/**
 * PREB-approved electricity rates for Puerto Rico.
 *
 * Source of truth is the `preb_rates` Supabase table seeded by
 * `supabase/migrations/0003_preb_rates_seed.sql`. This module gives the
 * frontend a typed, demo-mode-friendly fallback so the bill calculator works
 * without env vars and so unit tests don't have to mock the network.
 *
 * When PREB issues a new quarterly order, add a new migration with later
 * `effective_date` rows; `pickActiveRate` picks the latest <= the requested
 * date.
 */
import type { SourceId } from "./sources";

export type RateCategory = "residential" | "commercial";

export interface RateBreakdown {
  basePerKwh: number;
  fuelAdjustment: number;
  purchasedPower: number;
  fixedMonthly: number;
  effectiveDate: string; // ISO date
  source: SourceId;
  sourceUrl: string;
  effectivePerKwh: number; // base + fuel + ppa
}

interface RateRow {
  effective_date: string;
  rate_category: string;
  rate_per_kwh: number;
  source_url: string | null;
}

// Hard-coded mirror of migration 0003 so the bill calculator works offline.
// Keep in sync — the migration is the canonical source.
const FALLBACK_ROWS: RateRow[] = [
  { effective_date: "2026-01-01", rate_category: "residential_base",          rate_per_kwh: 0.13520, source_url: "https://lumapr.com/current-rates-for-electric-service-in-puerto-rico/?lang=en" },
  { effective_date: "2026-01-01", rate_category: "residential_fuel_adj",      rate_per_kwh: 0.07410, source_url: "https://energia.pr.gov/en/current-rate/" },
  { effective_date: "2026-01-01", rate_category: "residential_purchased_pwr", rate_per_kwh: 0.04290, source_url: "https://energia.pr.gov/en/current-rate/" },
  { effective_date: "2026-01-01", rate_category: "residential_fixed",         rate_per_kwh: 4.00000, source_url: "https://lumapr.com/current-rates-for-electric-service-in-puerto-rico/?lang=en" },
  { effective_date: "2026-01-01", rate_category: "commercial_base",           rate_per_kwh: 0.14180, source_url: "https://lumapr.com/current-rates-for-electric-service-in-puerto-rico/?lang=en" },
  { effective_date: "2026-01-01", rate_category: "commercial_fuel_adj",       rate_per_kwh: 0.07410, source_url: "https://energia.pr.gov/en/current-rate/" },
  { effective_date: "2026-01-01", rate_category: "commercial_purchased_pwr",  rate_per_kwh: 0.04290, source_url: "https://energia.pr.gov/en/current-rate/" },
  { effective_date: "2026-01-01", rate_category: "commercial_fixed",          rate_per_kwh: 7.50000, source_url: "https://lumapr.com/current-rates-for-electric-service-in-puerto-rico/?lang=en" },
];

function pickRows(rows: RateRow[], at: Date): RateRow[] {
  const target = at.toISOString().slice(0, 10);
  const dates = Array.from(new Set(rows.map((r) => r.effective_date)))
    .filter((d) => d <= target)
    .sort();
  if (dates.length === 0) return [];
  const active = dates[dates.length - 1];
  return rows.filter((r) => r.effective_date === active);
}

export function rowsToBreakdown(
  rows: RateRow[],
  category: RateCategory,
): RateBreakdown {
  const prefix = category === "residential" ? "residential_" : "commercial_";
  const get = (suffix: string) =>
    rows.find((r) => r.rate_category === `${prefix}${suffix}`)?.rate_per_kwh ?? 0;

  const basePerKwh = get("base");
  const fuelAdjustment = get("fuel_adj");
  const purchasedPower = get("purchased_pwr");
  const fixedMonthly = get("fixed");
  const effectiveDate = rows[0]?.effective_date ?? "1970-01-01";
  const sourceUrl =
    rows.find((r) => r.source_url)?.source_url ?? "https://energia.pr.gov/";

  return {
    basePerKwh,
    fuelAdjustment,
    purchasedPower,
    fixedMonthly,
    effectiveDate,
    source: "preb",
    sourceUrl,
    effectivePerKwh: basePerKwh + fuelAdjustment + purchasedPower,
  };
}

/**
 * Last-resort breakdown when neither real PREB ingestion (improvement C) nor
 * the migration-seeded `preb_rates` rows are available. Tagged with the
 * `preb-seed` source so the UI labels it accurately as "frozen seed" rather
 * than live PREB data.
 */
export function seedRate(
  category: RateCategory,
  at: Date = new Date(),
): RateBreakdown {
  const rows = pickRows(FALLBACK_ROWS, at);
  return { ...rowsToBreakdown(rows, category), source: "preb-seed" };
}

/** @deprecated Use `seedRate`. Kept as an alias to avoid breaking imports. */
export const fallbackRate = seedRate;

/**
 * Pick the active breakdown from a database row set. Returns null when no row
 * is effective at `at` — caller should fall back to `fallbackRate`.
 */
export function pickActiveRate(
  rows: RateRow[],
  category: RateCategory,
  at: Date = new Date(),
): RateBreakdown | null {
  const active = pickRows(rows, at);
  if (active.length === 0) return null;
  return rowsToBreakdown(active, category);
}
