/**
 * Demo data shown only when Supabase env points at the placeholder host.
 * Lets local dev render a realistic-looking dashboard without infra.
 * Never used in production (production sets a real Supabase URL).
 */

import type { GridSnapshot } from "./supabase";

export const DEMO_MODE =
  !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL.includes("placeholder");

export function demoSnapshot(): GridSnapshot {
  const now = new Date();
  // Round to the last 5-minute mark to look like real ingestion cadence.
  now.setMinutes(Math.floor(now.getMinutes() / 5) * 5);
  now.setSeconds(0);
  now.setMilliseconds(0);
  return {
    ts: now.toISOString(),
    current_demand_mw: 2418,
    next_hour_demand_mw: 2510,
    total_generation_mw: 2640,
    available_capacity_mw: 2740,
    spinning_reserve_mw: 145,
    operational_reserve_mw: 222,
    peak_demand_forecast_mw: 2828,
    peak_reserve_forecast_mw: 212,
    status: "watch",
    status_reasons: [
      "Forecast margin narrowing (230 MW headroom against 2,510 MW expected demand)",
      "Operational reserve close to 250 MW target",
    ],
    source: "lumapr.com",
    source_stale: false,
  };
}

export function demoUpdates() {
  const t = Date.now();
  return [
    {
      id: "demo-1",
      ts: new Date(t - 4 * 60_000).toISOString(),
      source: "official" as const,
      category: "planned-work",
      text: "Planned work posted near Caguas: pole replacement, possible interruption 9:00 AM – 2:00 PM.",
      url: "https://lumapr.com/mejorasplanificadas/",
    },
    {
      id: "demo-2",
      ts: new Date(t - 18 * 60_000).toISOString(),
      source: "official" as const,
      category: "system-overview",
      text: "LUMA System Overview refresh — reserves at 222 MW, demand 2,418 MW.",
      url: "https://lumapr.com/resumen-del-sistema/",
    },
    {
      id: "demo-3",
      ts: new Date(t - 32 * 60_000).toISOString(),
      source: "model" as const,
      category: "heuristic",
      text: "Grid status reclassified from NORMAL → WATCH as forecast margin narrows below 10%.",
    },
  ];
}
