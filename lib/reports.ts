/**
 * Community report type catalog + confidence bands.
 *
 * The DB stores `type` as a checked enum (see migration 0001 + 0008). Keep
 * this list in sync — every value here must exist in the SQL CHECK
 * constraint or the insert will fail.
 */

export type ReportType =
  | "no_power"
  | "low_voltage"
  | "flicker"
  | "transformer"
  | "pole"
  | "cable"
  | "tree"
  | "restored"
  | "crew_seen"
  | "appliance_damaged";

export interface ReportTypeMeta {
  type: ReportType;
  /** Spanish/English short label for the picker. */
  label: string;
  /** One-line description shown under the label. */
  hint: string;
  /** Affects risk score: outage > voltage > infrastructure > restoration. */
  weight: number;
}

export const REPORT_TYPES: ReportTypeMeta[] = [
  { type: "no_power",         label: "No power",            hint: "The lights are out where I am.",                  weight: 1.0 },
  { type: "low_voltage",      label: "Low voltage",          hint: "Things are dim or appliances are struggling.",    weight: 0.7 },
  { type: "flicker",          label: "Flickering",           hint: "Power keeps blinking on and off.",                weight: 0.5 },
  { type: "transformer",      label: "Transformer issue",   hint: "Heard a pop, saw smoke, or a flash on a pole.",   weight: 0.9 },
  { type: "pole",             label: "Pole damage",          hint: "A power pole is leaning, broken, or down.",        weight: 0.8 },
  { type: "cable",            label: "Cable down",           hint: "A line is hanging low or lying on the ground.",   weight: 0.95 },
  { type: "tree",             label: "Tree on line",         hint: "A tree or large branch is touching power lines.", weight: 0.7 },
  { type: "crew_seen",        label: "Crew seen",            hint: "LUMA crews are working on the lines here.",       weight: 0.2 },
  { type: "restored",         label: "Power restored",       hint: "It just came back on for me.",                     weight: -0.5 },
  { type: "appliance_damaged",label: "Appliance damaged",    hint: "Something stopped working after a surge.",        weight: 0.4 },
];

/**
 * Confidence band from raw count of recent reports near a cell.
 * Thresholds from the plan: 1–2 low, 3–10 medium, 10+ high.
 */
export function confidenceBand(count: number): "low" | "medium" | "high" {
  if (count >= 10) return "high";
  if (count >= 3) return "medium";
  return "low";
}

/** Color tint used by the map hex layer. */
export const REPORT_BAND_FILL: Record<"low" | "medium" | "high", string> = {
  low: "#fbbf24",
  medium: "#f97316",
  high: "#dc2626",
};

export function isValidType(s: string): s is ReportType {
  return REPORT_TYPES.some((t) => t.type === s);
}
