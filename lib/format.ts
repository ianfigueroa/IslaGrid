/**
 * Display formatters used across Bill / Solar / Battery / Grid dashboards.
 *
 * One source of truth so currency, energy, and power numbers render
 * consistently — a $1,200.34 bill, a 1,088 MW plant, a 5.5 kWh battery.
 * All helpers tolerate null/undefined gracefully and return "—" so the UI
 * doesn't need to guard each call site.
 */

const DASH = "—";

export function formatCurrency(
  value: number | null | undefined,
  opts: { minimumFractionDigits?: number; maximumFractionDigits?: number } = {},
): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: opts.minimumFractionDigits ?? 2,
    maximumFractionDigits: opts.maximumFractionDigits ?? 2,
  });
}

export function formatCurrencyCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  // For totals over $10k, drop the cents so the number scans.
  return Math.abs(value) >= 10_000
    ? formatCurrency(value, { maximumFractionDigits: 0 })
    : formatCurrency(value);
}

export function formatKwh(value: number | null | undefined, decimals = 0): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} kWh`;
}

export function formatMw(value: number | null | undefined, decimals = 0): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} MW`;
}

export function formatWatts(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  if (value >= 1000) {
    const kw = value / 1000;
    return `${kw.toLocaleString("en-US", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })} kW`;
  }
  return `${Math.round(value).toLocaleString("en-US")} W`;
}

export function formatPercent(value: number | null | undefined, decimals = 0): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}%`;
}

/** For "0.85" → "85%". Pass `decimals` for finer granularity. */
export function formatFractionAsPercent(
  value: number | null | undefined,
  decimals = 0,
): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  return formatPercent(value * 100, decimals);
}

export function formatHours(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  if (value < 1) return `${Math.round(value * 60)} min`;
  if (value < 24) return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })} h`;
  const days = value / 24;
  return `${days.toLocaleString("en-US", { maximumFractionDigits: 1 })} d`;
}

export function formatYears(value: number | null | undefined, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} yr`;
}
