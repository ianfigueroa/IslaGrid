/**
 * Thin client for NREL PVWatts v8.
 *
 * NREL migrated the developer portal host from `developer.nrel.gov` to
 * `developer.nlr.gov` on 2026-05-29. Default to the new host; allow override
 * via env so an operator can swap back if the new host blips.
 *
 * Docs: https://developer.nlr.gov/docs/solar/pvwatts/v8/
 */

const HOST = (process.env.NREL_API_HOST ?? "developer.nlr.gov").replace(
  /\/$/,
  "",
);

export interface PvwattsInputs {
  lat: number;
  lon: number;
  /** System DC capacity in kW. */
  systemKw: number;
  tilt?: number;
  azimuth?: number;
  /** Total system losses (%). */
  losses?: number;
  /** 0=Standard, 1=Premium, 2=Thin film. Default 0. */
  moduleType?: 0 | 1 | 2;
  /** 0=Fixed open rack, 1=Fixed roof mount, 2=1-axis, 3=1-axis backtracking, 4=2-axis. */
  arrayType?: 0 | 1 | 2 | 3 | 4;
}

export interface PvwattsResult {
  acAnnualKwh: number;
  acMonthlyKwh: number[]; // 12 entries, Jan..Dec
  solradAnnual: number;
  /** Per the PVWatts response — kWh/kW/year specific yield. */
  capacityFactor: number;
  apiHost: string;
}

export async function pvwatts(
  inputs: PvwattsInputs,
): Promise<PvwattsResult | null> {
  const apiKey = process.env.NREL_API_KEY;
  if (!apiKey) {
    // Honest mode: don't fabricate output. The caller renders an "assessment
    // pending — NREL_API_KEY not configured" state.
    return null;
  }
  const url = new URL(`https://${HOST}/api/pvwatts/v8.json`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("lat", inputs.lat.toFixed(4));
  url.searchParams.set("lon", inputs.lon.toFixed(4));
  url.searchParams.set("system_capacity", inputs.systemKw.toString());
  url.searchParams.set("module_type", String(inputs.moduleType ?? 0));
  url.searchParams.set("array_type", String(inputs.arrayType ?? 1));
  url.searchParams.set("losses", String(inputs.losses ?? 14));
  url.searchParams.set("tilt", String(inputs.tilt ?? 15));
  url.searchParams.set("azimuth", String(inputs.azimuth ?? 180));
  url.searchParams.set("timeframe", "monthly");

  const PVWATTS_TIMEOUT_MS = 10000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PVWATTS_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return null;
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return null;
  const json = (await res.json()) as {
    outputs?: {
      ac_annual?: number;
      ac_monthly?: number[];
      solrad_annual?: number;
      capacity_factor?: number;
    };
    errors?: string[];
  };
  const out = json.outputs;
  if (!out || typeof out.ac_annual !== "number") return null;

  return {
    acAnnualKwh: out.ac_annual,
    acMonthlyKwh: Array.isArray(out.ac_monthly) ? out.ac_monthly : [],
    solradAnnual: out.solrad_annual ?? 0,
    capacityFactor: out.capacity_factor ?? 0,
    apiHost: HOST,
  };
}
