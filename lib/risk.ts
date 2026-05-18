/**
 * Per-municipality outage-risk band, derived from the persisted baseline
 * (infrastructure vulnerability + planned work) plus live weather inputs.
 *
 * The baseline lives in the `municipality_risk_latest` view and is good for
 * an "average Tuesday." The weather lift below is what lets the band climb
 * when a real storm rolls in — without it, the map would still read "low"
 * during a hurricane warning.
 *
 * All thresholds are in one block so they can be tuned without hunting
 * through the function body.
 */

export type RiskBand = "low" | "elevated" | "high" | "severe" | "unknown";

const BAND_ORDER: RiskBand[] = ["low", "elevated", "high", "severe"];

// Weather → severity-bump thresholds. Conservative on purpose: we don't want
// every breeze to push every muni to "high." Tune over time as we see real
// storm correlations in the outage backfill.
export const RISK_WEATHER_THRESHOLDS = {
  /** Sustained wind that adds 1 band. kph. */
  WIND_KPH_BUMP_1: 30,
  /** Gust that adds 1 band on its own. kph. */
  GUST_KPH_BUMP_1: 60,
  /** Gust that adds 2 bands (hurricane-force ≈ 119 kph). */
  GUST_KPH_BUMP_2: 100,
  /** Heavy precip threshold for +1 band. mm in the latest snapshot. */
  PRECIP_MM_BUMP_1: 20,
} as const;

export interface WeatherInputs {
  wind_kph?: number | null;
  gust_kph?: number | null;
  precip_mm?: number | null;
  /** Free-form severity tag from upstream weather feed (e.g. "warning", "watch", "severe"). */
  alert_level?: string | null;
}

export interface AugmentResult {
  band: RiskBand;
  bumped_by: number;
  weather_reasons: string[];
}

/**
 * Lift the baseline band up the BAND_ORDER scale based on weather. Caps at
 * "severe" — we never escalate past the worst tier even if everything is
 * triggering at once.
 */
export function augmentRiskBand(
  baseline: RiskBand,
  weather: WeatherInputs | null | undefined,
): AugmentResult {
  if (baseline === "unknown" || !weather) {
    return { band: baseline, bumped_by: 0, weather_reasons: [] };
  }

  let bump = 0;
  const reasons: string[] = [];

  const wind = num(weather.wind_kph);
  const gust = num(weather.gust_kph);
  const precip = num(weather.precip_mm);
  const alert = (weather.alert_level ?? "").toLowerCase();

  if (gust >= RISK_WEATHER_THRESHOLDS.GUST_KPH_BUMP_2) {
    bump += 2;
    reasons.push(`Hurricane-force gusts (${Math.round(gust)} kph)`);
  } else if (gust >= RISK_WEATHER_THRESHOLDS.GUST_KPH_BUMP_1) {
    bump += 1;
    reasons.push(`Damaging gusts (${Math.round(gust)} kph)`);
  } else if (wind >= RISK_WEATHER_THRESHOLDS.WIND_KPH_BUMP_1) {
    bump += 1;
    reasons.push(`Strong sustained wind (${Math.round(wind)} kph)`);
  }

  if (precip >= RISK_WEATHER_THRESHOLDS.PRECIP_MM_BUMP_1) {
    bump += 1;
    reasons.push(`Heavy rain (${Math.round(precip)} mm)`);
  }

  if (alert.includes("warning") || alert.includes("severe")) {
    bump += 2;
    reasons.push(`Active NWS warning (${weather.alert_level})`);
  } else if (alert.includes("watch") || alert.includes("advisory")) {
    bump += 1;
    reasons.push(`NWS ${weather.alert_level}`);
  }

  if (bump === 0) {
    return { band: baseline, bumped_by: 0, weather_reasons: [] };
  }

  const baselineIdx = BAND_ORDER.indexOf(baseline);
  if (baselineIdx === -1) {
    return { band: baseline, bumped_by: 0, weather_reasons: [] };
  }
  const nextIdx = Math.min(BAND_ORDER.length - 1, baselineIdx + bump);
  return {
    band: BAND_ORDER[nextIdx],
    bumped_by: nextIdx - baselineIdx,
    weather_reasons: reasons,
  };
}

function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
