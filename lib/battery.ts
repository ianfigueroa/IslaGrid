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
  /**
   * Peak-to-continuous wattage ratio at startup. Motors (fridges, pumps,
   * compressors, mini-splits) commonly draw 2–5× their nameplate for a
   * fraction of a second at startup; the inverter needs to handle that
   * surge or it'll trip and shut down the critical loads. Defaults to 1.5
   * for unknown loads so the inverter has *some* headroom.
   */
  surgeMultiplier?: number;
  /** True for medical / safety loads — these get sized with extra headroom. */
  critical?: boolean;
}

export const APPLIANCE_LOADS: ApplianceLoad[] = [
  { id: "fridge",     label: "Refrigerator",          watts: 150,  dutyCycle: 0.35, surgeMultiplier: 3.0 },
  { id: "lights",     label: "LED lights (whole home)", watts: 80, dutyCycle: 0.50, surgeMultiplier: 1.0 },
  { id: "router",     label: "Router + modem",         watts: 25,  dutyCycle: 1.0,  surgeMultiplier: 1.2 },
  { id: "fan",        label: "Ceiling / pedestal fan", watts: 70,  dutyCycle: 0.70, surgeMultiplier: 2.0 },
  { id: "phone",      label: "Phone charging",         watts: 15,  dutyCycle: 0.30, surgeMultiplier: 1.0 },
  { id: "laptop",     label: "Laptop",                 watts: 60,  dutyCycle: 0.50, surgeMultiplier: 1.5 },
  { id: "cpap",       label: "CPAP machine",           watts: 60,  dutyCycle: 1.0,  surgeMultiplier: 1.5, critical: true },
  { id: "medical",    label: "Other medical device",   watts: 100, dutyCycle: 1.0,  surgeMultiplier: 1.5, critical: true },
  { id: "water-pump", label: "Water pump",             watts: 750, dutyCycle: 0.10, surgeMultiplier: 4.0 },
  { id: "minisplit",  label: "Mini-split A/C (1 ton)", watts: 1200, dutyCycle: 0.40, surgeMultiplier: 2.5 },
  { id: "tv",         label: "TV",                     watts: 100, dutyCycle: 0.40, surgeMultiplier: 1.2 },
  { id: "microwave",  label: "Microwave (occasional)", watts: 1100, dutyCycle: 0.03, surgeMultiplier: 1.3 },
];

/**
 * Three battery chemistries the residential PR market actually carries. The
 * numbers are deliberately conservative — installed cost reflects the median
 * PR quote (battery + inverter + balance-of-system + labor), not the cell
 * cost on its own. DOD is the manufacturer-rated usable depth of discharge.
 */
export interface BatteryChemistry {
  id: "lfp" | "nca" | "lto";
  label: string;
  /** Usable depth of discharge (0..1). */
  dod: number;
  /** Installed USD per kWh (median PR quote). */
  costPerKwh: number;
  /** Manufacturer cycle life at rated DOD. */
  cycleLife: number;
  /** One-line trade-off summary for the UI. */
  tradeoff: string;
}

export const CHEMISTRIES: BatteryChemistry[] = [
  {
    id: "lfp",
    label: "LFP (lithium iron phosphate)",
    dod: 0.9,
    costPerKwh: 950,
    cycleLife: 6000,
    tradeoff: "Default. Long cycle life, safest, mid cost. What most installers quote.",
  },
  {
    id: "nca",
    label: "NCA (nickel-cobalt-aluminum)",
    dod: 0.85,
    costPerKwh: 800,
    cycleLife: 3000,
    tradeoff: "Cheapest per kWh up front, denser, but shorter cycle life and more thermal risk.",
  },
  {
    id: "lto",
    label: "LTO (lithium titanate)",
    dod: 0.95,
    costPerKwh: 1600,
    cycleLife: 15000,
    tradeoff: "Premium. Fastest charge, longest life, deep DOD — overkill unless you're cycling daily.",
  },
];

export function chemistryById(id: BatteryChemistry["id"]): BatteryChemistry {
  return CHEMISTRIES.find((c) => c.id === id) ?? CHEMISTRIES[0]!;
}

export interface SizingInputs {
  selected: ApplianceLoad[];
  targetHours: number;
  /** Usable depth of discharge — overrides chemistry default if set. */
  dod?: number;
  /** Battery chemistry. Defaults to LFP. */
  chemistry?: BatteryChemistry["id"];
  /** Average sun hours per day (PR ≈ 5.5). */
  sunHoursPerDay?: number;
  /** kW of installed solar that recharges the battery. */
  solarKwInstalled?: number;
}

export interface SizingResult {
  averageWatts: number;
  /**
   * Peak watts the inverter needs to handle without tripping — sum of each
   * load's `watts × surgeMultiplier`. Not all loads surge at the same
   * instant in practice, but inverter spec sheets are rated to a single
   * worst-case so we don't divide by load count.
   */
  peakSurgeWatts: number;
  /**
   * Minimum inverter continuous rating we recommend, in watts. Sized to the
   * peak surge with a 10% buffer so the inverter isn't running at 100% of
   * spec when a motor starts.
   */
  recommendedInverterWatts: number;
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

export const BATTERY_COST_PER_KWH = 950; // USD installed, PR market midpoint (LFP)

export function sizeBattery(inputs: SizingInputs): SizingResult {
  const chem = chemistryById(inputs.chemistry ?? "lfp");
  const dod = inputs.dod ?? chem.dod;
  const sunHours = inputs.sunHoursPerDay ?? 5.5;
  const targetHours = Math.max(1, inputs.targetHours);

  const energyWhPerHour = inputs.selected.reduce(
    (sum, a) => sum + a.watts * a.dutyCycle,
    0,
  );
  const averageWatts = energyWhPerHour;

  // Peak surge: each load contributes watts × its surgeMultiplier (default
  // 1.5). Sum across all loads — pessimistic but matches how inverters are
  // spec'd (single worst-case rating, not load-coincidence-adjusted).
  const peakSurgeWatts = inputs.selected.reduce(
    (sum, a) => sum + a.watts * (a.surgeMultiplier ?? 1.5),
    0,
  );
  // 10% buffer above peak surge, rounded to the next 500 W since inverters
  // don't come in arbitrary sizes.
  const recommendedInverterWatts =
    Math.ceil((peakSurgeWatts * 1.1) / 500) * 500;

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
  if (peakSurgeWatts > 0 && peakSurgeWatts > energyWhPerHour * 2.5) {
    notes.push(
      `Heavy startup surge (${Math.round(peakSurgeWatts).toLocaleString()} W peak vs ${Math.round(energyWhPerHour).toLocaleString()} W continuous) — make sure the inverter is rated for the peak, not just the continuous draw.`,
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
    peakSurgeWatts,
    recommendedInverterWatts,
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

export function estimateCost(
  batteryKwh: number,
  chemistry: BatteryChemistry["id"] = "lfp",
): number {
  return batteryKwh * chemistryById(chemistry).costPerKwh;
}
