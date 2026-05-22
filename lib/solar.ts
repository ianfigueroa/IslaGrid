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

/**
 * Year-by-year cash-flow + NPV for the system, accounting for module
 * degradation and a (configurable) utility rate escalator. Returns one row
 * per year so the UI can show a table or chart.
 *
 * Discount rate defaults to 6% — roughly the cost of capital for a typical
 * PR homeowner who'd otherwise pay down a 6–7% mortgage with the cash.
 */
export interface CashFlowOptions {
  installCost: number;
  /** Year-1 production in kWh. */
  annualKwhYear1: number;
  effectiveRatePerKwh: number;
  /** Annual utility-rate escalator (e.g., 0.02 for 2%/yr). PR has averaged 3–4%. */
  rateEscalator?: number;
  /** Discount rate (e.g., 0.06 for 6%). */
  discountRate?: number;
  /** Years to project. PV warranties typically run 25 years. */
  horizonYears?: number;
  /** Override degradation rate (e.g., 0.005 = 0.5% per year). */
  degradationPerYear?: number;
}

export interface CashFlowYear {
  year: number;
  productionKwh: number;
  ratePerKwh: number;
  savings: number;
  cumulativeSavings: number;
  discountedSavings: number;
  cumulativeNpv: number;
}

export interface CashFlowProjection {
  rows: CashFlowYear[];
  /** NPV after horizonYears, net of installCost. */
  npv: number;
  /** Years until cumulative undiscounted savings cover installCost. */
  simplePaybackYears: number | null;
  /** Years until cumulative discounted savings cover installCost. */
  discountedPaybackYears: number | null;
  /** Total lifetime undiscounted savings. */
  lifetimeSavings: number;
}

export function projectCashFlow(opts: CashFlowOptions): CashFlowProjection {
  const horizon = Math.max(1, opts.horizonYears ?? 25);
  const escalator = opts.rateEscalator ?? 0.03;
  const discount = opts.discountRate ?? 0.06;
  const degradation = opts.degradationPerYear ?? SOLAR_ASSUMPTIONS.degradationPerYear;

  const rows: CashFlowYear[] = [];
  let cumSavings = 0;
  let cumDiscounted = -opts.installCost; // start in the hole by installCost
  let simplePayback: number | null = null;
  let discountedPayback: number | null = null;

  for (let y = 1; y <= horizon; y++) {
    const productionKwh = opts.annualKwhYear1 * Math.pow(1 - degradation, y - 1);
    const ratePerKwh = opts.effectiveRatePerKwh * Math.pow(1 + escalator, y - 1);
    const savings = productionKwh * ratePerKwh;
    cumSavings += savings;
    const discountedSavings = savings / Math.pow(1 + discount, y);
    cumDiscounted += discountedSavings;
    if (simplePayback === null && cumSavings >= opts.installCost) {
      // Linear interpolate within the year for a smoother number.
      const prevCum = cumSavings - savings;
      const fraction = (opts.installCost - prevCum) / savings;
      simplePayback = y - 1 + Math.max(0, Math.min(1, fraction));
    }
    if (discountedPayback === null && cumDiscounted >= 0) {
      const prevCum = cumDiscounted - discountedSavings;
      const fraction = (0 - prevCum) / discountedSavings;
      discountedPayback = y - 1 + Math.max(0, Math.min(1, fraction));
    }
    rows.push({
      year: y,
      productionKwh: Math.round(productionKwh),
      ratePerKwh: Math.round(ratePerKwh * 10000) / 10000,
      savings: Math.round(savings),
      cumulativeSavings: Math.round(cumSavings),
      discountedSavings: Math.round(discountedSavings),
      cumulativeNpv: Math.round(cumDiscounted),
    });
  }

  return {
    rows,
    npv: Math.round(cumDiscounted),
    simplePaybackYears: simplePayback === null ? null : Math.round(simplePayback * 10) / 10,
    discountedPaybackYears: discountedPayback === null ? null : Math.round(discountedPayback * 10) / 10,
    lifetimeSavings: Math.round(cumSavings),
  };
}

/**
 * Compare common ways to pay for the system. Each scenario returns
 * 25-year (or `horizonYears`) net cost to the homeowner. Cash and loan
 * cover the install up front; lease and PPA replace upfront cost with
 * monthly payments to a third-party owner.
 *
 * These are simplified models — actual deals depend on tax credits, the
 * specific PPA escalator, and resale impact on the home. The numbers are
 * directional, not contract-grade.
 */
export interface FinancingInputs {
  installCost: number;
  annualSavingsYear1: number;
  rateEscalator?: number;
  horizonYears?: number;
  /** Loan APR for the loan scenario, e.g., 0.075 for 7.5%. */
  loanRate?: number;
  /** Loan term in years for the loan scenario. */
  loanTermYears?: number;
  /** Monthly lease payment, in USD. */
  leaseMonthlyPayment?: number;
  /** PPA $/kWh — what the homeowner pays for solar production under a PPA. */
  ppaPricePerKwh?: number;
  /** Year-1 production for PPA accounting. */
  annualKwhYear1?: number;
  /** Discount rate. */
  discountRate?: number;
}

export interface FinancingScenario {
  id: "cash" | "loan" | "lease" | "ppa";
  label: string;
  upfrontCost: number;
  /** Net 25-year cash flow (positive = saved more than spent). */
  netLifetimeCashflow: number;
  /** Net 25-year NPV at `discountRate`. */
  npv: number;
  notes: string;
}

export function evaluateFinancing(inputs: FinancingInputs): FinancingScenario[] {
  const horizon = inputs.horizonYears ?? 25;
  const escalator = inputs.rateEscalator ?? 0.03;
  const discount = inputs.discountRate ?? 0.06;

  // Year-by-year grid-rate savings (assumes production stays roughly
  // constant year-1 for financing comparison; full degradation is captured
  // in projectCashFlow).
  const savings: number[] = [];
  for (let y = 1; y <= horizon; y++) {
    savings.push(inputs.annualSavingsYear1 * Math.pow(1 + escalator, y - 1));
  }
  const totalSavings = savings.reduce((s, v) => s + v, 0);
  const npvSavings = savings.reduce(
    (s, v, i) => s + v / Math.pow(1 + discount, i + 1),
    0,
  );

  const scenarios: FinancingScenario[] = [];

  // Cash: upfront cost, savings every year.
  scenarios.push({
    id: "cash",
    label: "Cash",
    upfrontCost: inputs.installCost,
    netLifetimeCashflow: Math.round(totalSavings - inputs.installCost),
    npv: Math.round(npvSavings - inputs.installCost),
    notes: "Pay in full. Largest NPV when capital is available.",
  });

  // Loan: amortized payment over loanTermYears at loanRate. Net cash flow =
  // savings - loan payments.
  if (inputs.loanRate && inputs.loanTermYears) {
    const monthsTerm = inputs.loanTermYears * 12;
    const monthlyRate = inputs.loanRate / 12;
    const monthlyPayment =
      monthlyRate > 0
        ? (inputs.installCost * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -monthsTerm))
        : inputs.installCost / monthsTerm;
    const annualLoanPayment = monthlyPayment * 12;
    const loanCostsByYear: number[] = [];
    for (let y = 1; y <= horizon; y++) {
      loanCostsByYear.push(y <= inputs.loanTermYears ? annualLoanPayment : 0);
    }
    const netCashflow = savings.reduce(
      (s, v, i) => s + v - (loanCostsByYear[i] ?? 0),
      0,
    );
    const npvLoan = savings.reduce(
      (s, v, i) =>
        s + (v - (loanCostsByYear[i] ?? 0)) / Math.pow(1 + discount, i + 1),
      0,
    );
    scenarios.push({
      id: "loan",
      label: `Loan (${(inputs.loanRate * 100).toFixed(1)}% × ${inputs.loanTermYears}y)`,
      upfrontCost: 0,
      netLifetimeCashflow: Math.round(netCashflow),
      npv: Math.round(npvLoan),
      notes: `Monthly payment ≈ $${Math.round(monthlyPayment).toLocaleString()}. Cashflow-positive once savings exceed the payment.`,
    });
  }

  // Lease: fixed monthly payment, savings - payment.
  if (inputs.leaseMonthlyPayment) {
    const annualLease = inputs.leaseMonthlyPayment * 12;
    const leaseEscalator = 0.029; // typical industry escalator
    const leaseCostsByYear = savings.map((_, i) =>
      annualLease * Math.pow(1 + leaseEscalator, i),
    );
    const netCashflow = savings.reduce(
      (s, v, i) => s + v - (leaseCostsByYear[i] ?? 0),
      0,
    );
    const npvLease = savings.reduce(
      (s, v, i) =>
        s + (v - (leaseCostsByYear[i] ?? 0)) / Math.pow(1 + discount, i + 1),
      0,
    );
    scenarios.push({
      id: "lease",
      label: `Lease ($${inputs.leaseMonthlyPayment}/mo)`,
      upfrontCost: 0,
      netLifetimeCashflow: Math.round(netCashflow),
      npv: Math.round(npvLease),
      notes: "Third-party owns the system. No tax-credit benefit to you, but no upfront cost.",
    });
  }

  // PPA: pay per kWh produced. Net = grid savings - PPA price × production.
  if (inputs.ppaPricePerKwh && inputs.annualKwhYear1) {
    const ppaCostsByYear: number[] = [];
    for (let y = 1; y <= horizon; y++) {
      ppaCostsByYear.push(
        inputs.annualKwhYear1 *
          inputs.ppaPricePerKwh *
          Math.pow(1 + 0.024, y - 1), // PPA escalator ~2.4%
      );
    }
    const netCashflow = savings.reduce(
      (s, v, i) => s + v - (ppaCostsByYear[i] ?? 0),
      0,
    );
    const npvPpa = savings.reduce(
      (s, v, i) =>
        s + (v - (ppaCostsByYear[i] ?? 0)) / Math.pow(1 + discount, i + 1),
      0,
    );
    scenarios.push({
      id: "ppa",
      label: `PPA ($${inputs.ppaPricePerKwh.toFixed(2)}/kWh)`,
      upfrontCost: 0,
      netLifetimeCashflow: Math.round(netCashflow),
      npv: Math.round(npvPpa),
      notes: "You buy the solar kWh at a fixed rate. Best when PPA price is well below grid rate.",
    });
  }

  return scenarios;
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
