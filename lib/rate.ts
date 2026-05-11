/**
 * Hand-curated PREB tariff snapshot — bill calculator is deferred to Phase 6+.
 * This file exists so the data path is defined and the migration's `preb_rates`
 * table has at least one seed row.
 *
 * Source of truth: https://energia.pr.gov/en/current-rate/
 * Update process: when PREB issues a new rate, append a row here and a
 * matching row to `preb_rates`. No automated ingestion.
 */

export interface PrebRate {
  effectiveDate: string;     // ISO date
  category: "residential" | "commercial-small" | "commercial-large" | "industrial";
  perKwh: number;            // USD per kWh
  notes?: string;
}

export const PREB_RATES: PrebRate[] = [
  {
    effectiveDate: "2026-01-01",
    category: "residential",
    perKwh: 0.27,
    notes:
      "Effective $/kWh estimate including fuel + purchased-power adjustments. " +
      "Hand-entered for MVP; verify against PREB tariff book before quoting.",
  },
];

export function currentRate(category: PrebRate["category"]): PrebRate | undefined {
  return PREB_RATES.filter((r) => r.category === category)
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0];
}
