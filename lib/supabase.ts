import { createBrowserClient, createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

/** Browser client — uses the public anon key, respects RLS. */
export function getBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

/** Server client for App Router server components / API routes. */
export function getServerSupabase() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => [],
        setAll: () => {},
      },
    },
  );
}

/**
 * Service-role client — server-only, bypasses RLS. Use ONLY in ingestion or
 * trusted server jobs. Never expose to the browser.
 */
export function getServiceSupabase() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type GridStatus = "normal" | "watch" | "strained" | "critical" | "stale" | "unknown";

export interface GridSnapshot {
  ts: string;
  current_demand_mw: number | null;
  next_hour_demand_mw: number | null;
  total_generation_mw: number | null;
  available_capacity_mw: number | null;
  spinning_reserve_mw: number | null;
  operational_reserve_mw: number | null;
  peak_demand_forecast_mw: number | null;
  peak_reserve_forecast_mw: number | null;
  status: GridStatus;
  status_reasons: string[];
  source: string;
  source_stale: boolean;
}
