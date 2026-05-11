/**
 * Pure functions for the battery backup simulator.
 *
 * The library is short on purpose — sizing a residential backup battery is
 * primarily a load-vs-runtime calculation. We round the outputs aggressively
 * because input precision (duty cycle, ambient temperature, surge headroom)
 * doesn't justify decimal-place precision in the answer.
 */

export interface ApplianceLoad {
  id: string;
  label: string;
  /** Continuous watts when running. */
  watts: number;
  /** Fraction of the hour the appliance actually draws power (0..1). */
  dutyCycle: number;
  /** True for medical / safety loads — these get sized with extra headroom. */
  critical?: boolean;
}

export const APPLIANCE_LOADS: ApplianceLoad[] = [
  { id: "fridge",          label: "Refrigerator",          watts: 150,  dutyCycle: 0.35 },
  { id: "lights",          label: "LED lights (whole home)", watts: 80,   dutyCycle: 0.50 },
  { id: "router",          label: "Router + modem",         watts: 25,   dutyCycle: 1.0 },
  { id: "fan",             label: "Ceiling / pedestal fan", watts: 70,   dutyCycle: 0.70 },
  { id: "phone",           label: "Phone charging",         watts: 15,   dutyCycle: 0.30 },
  { id: "laptop",          label: "Laptop",                 watts: 60,   dutyCycle: 0.50 },
  { id: "cpap",            label: "CPAP machine",           watts: 60,   dutyCycle: 1.0,  critical: true },
  { id: "medical",         label: "Other medical device",   watts: 100,  dutyCycle: 1.0,  critical: true },
  { id: "water-pump",      label: "Water pump",             watts: 750,  dutyCycle: 0.10 },
  { id: "minisplit",       label: "Mini-split A/C (1 ton)", watts: 1200, dutyCycle: 0.40 },
  { id: "tv",              label: "TV",                     watts: 100,  dutyCycle: 0.40 },
  { id: "microwave",       label: "Microwave (occasional)", watts: 1100, dutyCycle: 0.03 },
];

export interface SizingInputs {
  selected: ApplianceLoad[];
  targetHours: number;
  /** Usable depth of discharge — LFP batteries typically usable to 90%. */
  dod?: number;
  /** Average sun hours per day (PR ≈ 5.5). */
  sunHoursPerDay?: number;
  /** Watts of installed solar that recharges the battery. */
  solarKwInstalled?: number;
}

export interface SizingResult {
  averageWatts: number;
  energyWhPerHour: number;
  totalWhNeeded: number;
  batteryKwhRecommended: number;
  realisticHours: number;
  stormReserveKwh: number;
  /** Solar recharge per day in kWh, given the assumed sun-hours and array size. */
  solarRechargeKwhPerDay: number;
  cloudyDayWarning: boolean;
  notes: string[];
}

export const BATTERY_COST_PER_KWH = 950; // USD installed, PR market midpoint

export function sizeBattery(inputs: SizingInputs): SizingResult {
  const dod = inputs.dod ?? 0.9;
  const sunHours = inputs.sunHoursPerDay ?? 5.5;
  const targetHours = Math.max(1, inputs.targetHours);

  const energyWhPerHour = inputs.selected.reduce(
    (sum, a) => sum + a.watts * a.dutyCycle,
    0,
  );
  const averageWatts = energyWhPerHour;
  const totalWhNeeded = energyWhPerHour * targetHours;

  // Battery sizing: needed_Wh / DOD.
  const batteryKwhRaw = totalWhNeeded / dod / 1000;
  // Round up to the nearest standard pack (5 kWh increments).
  const batteryKwhRecommended = Math.max(
    5,
    Math.ceil(batteryKwhRaw / 5) * 5,
  );

  // Add a 20% storm-prep reserve.
  const stormReserveKwh = Math.round(batteryKwhRecommended * 0.2 * 10) / 10;

  // Realistic hours from the rounded-up battery, recomputed.
  const realisticHours =
    energyWhPerHour > 0
      ? Math.floor((batteryKwhRecommended * 1000 * dod) / energyWhPerHour)
      : 0;

  const solarRechargeKwhPerDay = (inputs.solarKwInstalled ?? 0) * sunHours;

  const notes: string[] = [];
  if (inputs.selected.some((a) => a.critical)) {
    notes.push(
      "Critical loads selected — wire to a dedicated critical-load panel so the inverter only powers these during outages.",
    );
  }
  const cloudyDayWarning =
    solarRechargeKwhPerDay > 0 &&
    solarRechargeKwhPerDay < batteryKwhRecommended / targetHours;
  if (cloudyDayWarning) {
    notes.push(
      "Solar recharge is borderline at 5.5 sun-hours/day. Plan for two cloudy days in a row.",
    );
  }
  if (energyWhPerHour > 5000) {
    notes.push(
      "Heavy continuous load (>5 kW) — a single inverter may not be enough. Talk to an installer about parallel inverters.",
    );
  }

  return {
    averageWatts,
    energyWhPerHour,
    totalWhNeeded,
    batteryKwhRecommended,
    realisticHours,
    stormReserveKwh,
    solarRechargeKwhPerDay,
    cloudyDayWarning,
    notes,
  };
}

export function estimateCost(batteryKwh: number): number {
  return batteryKwh * BATTERY_COST_PER_KWH;
}
