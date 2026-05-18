/**
 * Canonical fuel-type palette + labels shared by the map, fuel-mix bar,
 * and plant tables. Single source of truth — adding a new fuel only
 * requires updating this file.
 *
 * Tone: soft, warm — no AI-tech cyan. Chosen so multiple fuels can stack
 * in a horizontal bar without any one slice dominating.
 */
export const FUEL_COLOR: Record<string, string> = {
  oil: "#c2865a",
  diesel: "#c2865a",
  gas: "#d97706",
  coal: "#6b7280",
  solar: "#f5b942",
  wind: "#94a3b8",
  hydro: "#38bdf8",
  landfill: "#84cc16",
  battery: "#2dd4bf",
  unknown: "#525252",
};

export const FUEL_LABEL: Record<string, string> = {
  oil: "Oil",
  diesel: "Diesel",
  gas: "Natural gas",
  coal: "Coal",
  solar: "Solar",
  wind: "Wind",
  hydro: "Hydro",
  landfill: "Landfill gas",
  battery: "Battery",
  unknown: "Other",
};

export function fuelColor(fuel: string | null | undefined): string {
  if (!fuel) return FUEL_COLOR.unknown;
  return FUEL_COLOR[fuel] ?? FUEL_COLOR.unknown;
}

export function fuelLabel(fuel: string | null | undefined): string {
  if (!fuel) return FUEL_LABEL.unknown;
  return FUEL_LABEL[fuel] ?? fuel;
}
