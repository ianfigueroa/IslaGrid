/**
 * EXPERIMENTAL — demand pressure heatmap, v0.
 *
 * This is a coarse PROXY built from public data we already have on hand. We
 * do NOT have feeder-level demand for Puerto Rico — LUMA's BPS Daily Report
 * publishes only island-wide totals. This module therefore estimates a
 * relative "pressure" per municipality (0..100) from inputs that are
 * directionally correlated with cooling-load demand:
 *
 *   pressure = w_pop * population_density_norm
 *            + w_temp * temperature_above_baseline
 *            + w_tod * time_of_day_curve
 *            + w_grid * island_grid_stress
 *
 * Anything labeled "demand" or "pressure" coming out of this file is a
 * RELATIVE indicator, not megawatts. The API + UI surface this rule.
 */

export interface DemandInputs {
  populationDensity: number; // people / km², per municipality
  temperatureC: number | null; // latest weather snapshot for this muni
  /** Current hour in local time, 0..23. */
  localHour: number;
  /** Latest island-wide grid stress 0..1 (1 = peak shortfall). */
  islandGridStress: number;
}

export interface DemandResult {
  /** 0..100 relative pressure. NOT MW. */
  pressure: number;
  band: "low" | "moderate" | "elevated" | "peak";
  reasons: string[];
  /** Component breakdown for the UI so we can show "why". */
  components: {
    population: number;
    temperature: number;
    timeOfDay: number;
    gridStress: number;
  };
}

// Weights are heuristic; the file's docstring explains the proxy nature.
const W = { pop: 0.25, temp: 0.25, tod: 0.30, grid: 0.20 };

// PR municipality density goes from ~50 (Culebra) to ~4,500 (San Juan)
// people/km². Cap normalization at 3,000 so dense municipalities don't pin
// the scale.
const POP_NORM_HI = 3000;

// Baseline temperature: 26°C is the rough cooling-on threshold for
// residential A/C in PR (per PRPlanning Board climate norms). Anything
// above adds load roughly linearly until ~32°C.
const TEMP_BASELINE_C = 26;
const TEMP_SPAN_C = 6;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Hour-of-day demand curve. PR load is bimodal: midday A/C peak around
 * 13:00-15:00 and evening peak ~19:00-22:00. Trough around 04:00-05:00.
 * Curve values 0..1 here.
 */
function todCurve(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  // Soft-shape curve: combine two Gaussian humps.
  const midday = Math.exp(-Math.pow((h - 14) / 2.2, 2));
  const evening = Math.exp(-Math.pow((h - 20) / 1.8, 2));
  return clamp(0.25 + 0.55 * midday + 0.65 * evening, 0, 1);
}

export function demandPressure(inputs: DemandInputs): DemandResult {
  const popNorm = clamp(inputs.populationDensity / POP_NORM_HI, 0, 1);
  const tempNorm =
    inputs.temperatureC == null
      ? 0
      : clamp((inputs.temperatureC - TEMP_BASELINE_C) / TEMP_SPAN_C, 0, 1);
  const todNorm = todCurve(inputs.localHour);
  const gridNorm = clamp(inputs.islandGridStress, 0, 1);

  const pressure = clamp(
    100 *
      (W.pop * popNorm +
        W.temp * tempNorm +
        W.tod * todNorm +
        W.grid * gridNorm),
    0,
    100,
  );

  const reasons: string[] = [];
  if (popNorm > 0.6) reasons.push("Densely populated area");
  if (tempNorm > 0.5) reasons.push("Hot — AC load expected");
  if (todNorm > 0.7)
    reasons.push(
      inputs.localHour >= 18
        ? "Evening peak window"
        : "Midday AC peak window",
    );
  if (gridNorm > 0.5) reasons.push("Island-wide grid is already stressed");

  let band: DemandResult["band"] = "low";
  if (pressure >= 70) band = "peak";
  else if (pressure >= 50) band = "elevated";
  else if (pressure >= 30) band = "moderate";

  return {
    pressure: Math.round(pressure),
    band,
    reasons,
    components: {
      population: Math.round(popNorm * 100),
      temperature: Math.round(tempNorm * 100),
      timeOfDay: Math.round(todNorm * 100),
      gridStress: Math.round(gridNorm * 100),
    },
  };
}

export const DEMAND_FILL: Record<DemandResult["band"], string> = {
  low: "#a3e635",
  moderate: "#facc15",
  elevated: "#f97316",
  peak: "#dc2626",
};
