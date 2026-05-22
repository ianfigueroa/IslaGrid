/**
 * Color palettes used across the map's data layers. Pulled out of GridMap.tsx
 * so the loaders (risk, demand, alerts, reports) can be split into their own
 * modules without cyclically importing GridMap. Each palette is intentionally
 * a flat record so the loader can do `PALETTE[band]` and fall back to an
 * "unknown" entry without a switch statement.
 *
 * Color philosophy: status fills stay cool/neutral, risk shifts warm, and
 * reports shift even warmer — stacking the layers gives a visual hierarchy
 * (status base, risk overlay, then community-source overlay on top).
 */

// Per-municipality status fill — kept warm + readable over the Protomaps
// light flavor. Saturation stays mid so colors register without overpowering
// the basemap.
export const STATUS_FILL: Record<string, string> = {
  normal: "#10b981",
  watch: "#f59e0b",
  strained: "#fb923c",
  critical: "#ef4444",
  stale: "#94a3b8",
  unknown: "#cbd5e1",
};

// NWS event types → severity color. Falls back to a neutral amber for unknowns.
export const ALERT_COLOR: Record<string, string> = {
  "Hurricane Warning":         "#7f1d1d",
  "Hurricane Watch":           "#b91c1c",
  "Tropical Storm Warning":    "#dc2626",
  "Tropical Storm Watch":      "#ea580c",
  "Flash Flood Warning":       "#dc2626",
  "Flood Warning":             "#ea580c",
  "Flood Watch":               "#f59e0b",
  "High Wind Warning":         "#ea580c",
  "Wind Advisory":             "#f59e0b",
  "Heat Advisory":             "#f97316",
  "Severe Thunderstorm Warning": "#dc2626",
  "Special Weather Statement": "#facc15",
};

export function alertFillFor(event: string): string {
  return ALERT_COLOR[event] ?? "#facc15";
}

// Heuristic risk band → fill color (always warmer than grid status to avoid
// confusion between "status" and "risk").
export const RISK_FILL: Record<string, string> = {
  low:      "#65a30d",
  elevated: "#eab308",
  high:     "#ea580c",
  severe:   "#dc2626",
  unknown:  "#525252",
};

// Community-report confidence band → fill color. Always warmer than risk so
// the two layers stay visually distinct when stacked.
export const REPORT_FILL: Record<string, string> = {
  low:    "#fbbf24",
  medium: "#f97316",
  high:   "#dc2626",
};

// EXPERIMENTAL demand-pressure layer — see lib/demand.ts. Lime → red.
export const DEMAND_FILL: Record<string, string> = {
  low:      "#a3e635",
  moderate: "#facc15",
  elevated: "#f97316",
  peak:     "#dc2626",
  unknown:  "#525252",
};
