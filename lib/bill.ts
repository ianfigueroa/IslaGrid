/**
 * Pure functions for the electricity bill / kWh calculator.
 *
 * All inputs are explicit so this module is trivially unit-testable and works
 * the same way in the browser and in any future Node-side use. The shape
 * mirrors PREB's tariff-book line items, not a simplified single $/kWh number.
 */
import type { RateBreakdown } from "./rates";

export interface Appliance {
  id: string;
  name: string;
  watts: number;
  hoursPerDay: number;
}

export interface BillBreakdown {
  usageKwh: number;
  baseEnergy: number;
  fuelAdj: number;
  purchasedPwr: number;
  fixed: number;
  total: number;
  effectivePerKwh: number; // total / usageKwh (when usage > 0)
}

export interface ApplianceContribution {
  id: string;
  name: string;
  kwhPerMonth: number;
  costPerMonth: number;
  shareOfBill: number; // 0..1
}

/** Monthly kWh from a single appliance. Defaults to 30-day months. */
export function applianceKwh(
  watts: number,
  hoursPerDay: number,
  daysPerMonth = 30,
): number {
  if (watts <= 0 || hoursPerDay <= 0) return 0;
  return (watts / 1000) * hoursPerDay * daysPerMonth;
}

export function applianceCost(
  watts: number,
  hoursPerDay: number,
  ratePerKwh: number,
  daysPerMonth = 30,
): number {
  return applianceKwh(watts, hoursPerDay, daysPerMonth) * ratePerKwh;
}

/**
 * Build the line-itemized bill. We do NOT add taxes — PREB tariffs are
 * itemized pre-tax in the published books, and the disclaimer on the page
 * makes clear we're showing a rate-driven estimate, not a final invoice.
 */
export function estimateBill(
  usageKwh: number,
  rate: RateBreakdown,
): BillBreakdown {
  const usage = Math.max(0, usageKwh);
  const baseEnergy = usage * rate.basePerKwh;
  const fuelAdj = usage * rate.fuelAdjustment;
  const purchasedPwr = usage * rate.purchasedPower;
  const fixed = rate.fixedMonthly;
  const total = baseEnergy + fuelAdj + purchasedPwr + fixed;
  return {
    usageKwh: usage,
    baseEnergy,
    fuelAdj,
    purchasedPwr,
    fixed,
    total,
    effectivePerKwh: usage > 0 ? total / usage : 0,
  };
}

export function rankAppliances(
  appliances: Appliance[],
  ratePerKwh: number,
  billTotal: number,
): ApplianceContribution[] {
  const rows = appliances.map((a) => {
    const kwh = applianceKwh(a.watts, a.hoursPerDay);
    const cost = kwh * ratePerKwh;
    return {
      id: a.id,
      name: a.name,
      kwhPerMonth: kwh,
      costPerMonth: cost,
      shareOfBill: billTotal > 0 ? cost / billTotal : 0,
    };
  });
  return rows.sort((a, b) => b.costPerMonth - a.costPerMonth);
}

export interface SolarScenario {
  offsetKwh: number;
  newGridKwh: number;
  savings: number;
  effectivePerKwhAfter: number;
}

/**
 * Apply a fixed monthly solar offset to a bill. PR net-metering credits
 * energy 1:1 at the residential rate (PREB Resolution), so we use
 * `effectivePerKwh` to value the offset.
 */
export function solarOffsetSavings(
  usageKwh: number,
  offsetKwh: number,
  rate: RateBreakdown,
): SolarScenario {
  const safeOffset = Math.min(offsetKwh, usageKwh);
  const newGridKwh = Math.max(0, usageKwh - safeOffset);
  const before = estimateBill(usageKwh, rate);
  const after = estimateBill(newGridKwh, rate);
  return {
    offsetKwh: safeOffset,
    newGridKwh,
    savings: before.total - after.total,
    effectivePerKwhAfter: after.effectivePerKwh,
  };
}

/** Common PR home/office appliances — defaults for the calculator UI. */
export const APPLIANCE_PRESETS: Omit<Appliance, "id">[] = [
  { name: "Mini-split A/C (1 ton)",  watts: 1200, hoursPerDay: 8 },
  { name: "Refrigerator",            watts: 150,  hoursPerDay: 12 },
  { name: "Water heater (electric)", watts: 4000, hoursPerDay: 2 },
  { name: "Clothes dryer",           watts: 3000, hoursPerDay: 0.5 },
  { name: "Gaming PC",               watts: 400,  hoursPerDay: 5 },
  { name: "Microwave",               watts: 1100, hoursPerDay: 0.25 },
  { name: "LED lights (whole home)", watts: 80,   hoursPerDay: 5 },
  { name: "Ceiling fan",             watts: 60,   hoursPerDay: 10 },
  { name: "Washing machine",         watts: 500,  hoursPerDay: 0.5 },
  { name: "Television (55\" LED)",   watts: 100,  hoursPerDay: 4 },
];
