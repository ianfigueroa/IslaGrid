/**
 * Pure functions for the Solar Lens. No network here — the API route does the
 * NREL PVWatts call and feeds the numbers in.
 *
 * Every assumption used by these helpers is exported via `SOLAR_ASSUMPTIONS`
 * so the UI can render them and the user can see what's being used.
 */

export interface SolarAssumptions {
  /** Installed-cost per watt, USD. PR market is high relative to mainland US. */
  installCostPerWatt: number;
  /** Battery pack installed cost per kWh, USD. */
  batteryCostPerKwh: number;
  /** Annual degradation rate applied to year-1 production. */
  degradationPerYear: number;
  /** Tilt assumed when we don't have a rooftop-specific number. */
  defaultTiltDeg: number;
  /** Azimuth (0=N, 90=E, 180=S, 270=W). PR optimum is south-facing. */
  defaultAzimuthDeg: number;
  /** Inverter + soiling losses (%). PVWatts default is 14. */
  defaultLossesPct: number;
  /** Target fraction of monthly grid kWh to offset when recommending size. */
  defaultOffsetTarget: number;
  /** Years to amortize payback over before declaring "not worth it". */
  paybackHorizonYears: number;
}

export const SOLAR_ASSUMPTIONS: SolarAssumptions = {
  // PR market data: average residential install costs ran $3.00–$3.50/W in
  // 2024–2025 per LBNL Tracking the Sun PR cohort. Use $3.20 as midpoint.
  installCostPerWatt: 3.2,
  batteryCostPerKwh: 950,
  degradationPerYear: 0.005,
  defaultTiltDeg: 15,
  defaultAzimuthDeg: 180,
  defaultLossesPct: 14,
  defaultOffsetTarget: 0.85,
  paybackHorizonYears: 12,
};

export interface AssessmentInputs {
  monthlyKwh: number;       // user's typical monthly usage
  effectiveRatePerKwh: number;
  annualKwhFromPv: number;  // NREL PVWatts output
  systemKw: number;         // sized for this site
  withBattery: boolean;
  /** Hours of recent outages per month (used by resilience score). */
  outageHoursPerMonth?: number;
}

export interface AssessmentResult {
  /** Recommended system size in kW DC. */
  systemKw: number;
  annualKwh: number;
  monthlyOffsetKwh: number;
  monthlySavings: number;
  paybackYears: number | null;
  installCost: number;
  batteryKwhRecommended: number;
  batteryCost: number;
  /** 0..100 overall score. */
  score: number;
  financialScore: number;
  resilienceScore: number;
  topReasons: string[];
}

export function recommendSystemSize(
  monthlyKwh: number,
  offsetTarget = SOLAR_ASSUMPTIONS.defaultOffsetTarget,
): number {
  // PR average specific yield ~1500 kWh/kW/year per NREL PVWatts; monthly ~125.
  const annualTarget = monthlyKwh * 12 * offsetTarget;
  const sizeKw = annualTarget / 1500;
  // Round up to nearest 0.4 kW (typical module step).
  return Math.max(2, Math.round(sizeKw * 2.5) / 2.5);
}

export function estimatePayback(
  installCostUsd: number,
  monthlySavingsUsd: number,
): number | null {
  if (monthlySavingsUsd <= 0) return null;
  return installCostUsd / (monthlySavingsUsd * 12);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function scoreAssessment(
  result: Omit<AssessmentResult, "score" | "financialScore" | "resilienceScore" | "topReasons">,
  inputs: AssessmentInputs,
): { score: number; financialScore: number; resilienceScore: number; topReasons: string[] } {
  const reasons: string[] = [];

  // Financial: payback <= 6 years → 100, >= 12 years or null → 0.
  let financial = 0;
  if (result.paybackYears != null) {
    if (result.paybackYears <= 6) {
      financial = 100;
      reasons.push(`Payback under 6 years (${result.paybackYears.toFixed(1)} years)`);
    } else if (result.paybackYears >= SOLAR_ASSUMPTIONS.paybackHorizonYears) {
      financial = 5;
      reasons.push(`Payback exceeds ${SOLAR_ASSUMPTIONS.paybackHorizonYears} years`);
    } else {
      financial = Math.round(100 - ((result.paybackYears - 6) / 6) * 95);
      reasons.push(`Payback ~${result.paybackYears.toFixed(1)} years`);
    }
  } else {
    reasons.push("System would not pay back at current rates");
  }

  // Resilience: depends on battery + local outage hours.
  let resilience = 0;
  if (inputs.withBattery) {
    const outage = inputs.outageHoursPerMonth ?? 6;
    resilience = clamp(40 + outage * 5, 40, 95);
    reasons.push(
      `Battery provides backup during PR's typical ${Math.round(outage)} h/month of outages`,
    );
  } else {
    const outage = inputs.outageHoursPerMonth ?? 6;
    resilience = clamp(15 + outage, 5, 35);
    if (outage > 12) {
      reasons.push("High outage hours — battery strongly recommended");
    } else {
      reasons.push("No battery: production stops during grid outages");
    }
  }

  // Offset coverage adds a small bump.
  const coverageBonus = clamp(
    (result.monthlyOffsetKwh / Math.max(1, inputs.monthlyKwh)) * 20,
    0,
    20,
  );

  // Weighted overall — financial dominates because PR rates are high and
  // payback is what most owners care about.
  const score = Math.round(
    clamp(financial * 0.6 + resilience * 0.3 + coverageBonus, 0, 100),
  );
  return {
    score,
    financialScore: Math.round(financial),
    resilienceScore: Math.round(resilience),
    topReasons: reasons,
  };
}

export function assess(inputs: AssessmentInputs): AssessmentResult {
  const monthlyOffsetKwh = Math.min(
    inputs.monthlyKwh,
    inputs.annualKwhFromPv / 12,
  );
  const monthlySavings = monthlyOffsetKwh * inputs.effectiveRatePerKwh;
  const installCost = inputs.systemKw * 1000 * SOLAR_ASSUMPTIONS.installCostPerWatt;
  const paybackYears = estimatePayback(installCost, monthlySavings);

  // Battery sizing: 1 day of evening + nighttime essentials when withBattery.
  // 30% of daily usage is a reasonable critical-load fraction in PR.
  const batteryKwhRecommended = inputs.withBattery
    ? Math.max(10, Math.round((inputs.monthlyKwh / 30) * 0.3 * 10) / 10)
    : 0;
  const batteryCost = batteryKwhRecommended * SOLAR_ASSUMPTIONS.batteryCostPerKwh;

  const base = {
    systemKw: inputs.systemKw,
    annualKwh: inputs.annualKwhFromPv,
    monthlyOffsetKwh,
    monthlySavings,
    paybackYears,
    installCost,
    batteryKwhRecommended,
    batteryCost,
  };
  const scored = scoreAssessment(base, inputs);
  return { ...base, ...scored };
}
