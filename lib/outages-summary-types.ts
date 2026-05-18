/**
 * Shared types for /api/outages/summary. Lives in lib/ so the server route
 * and the client OutagesPanel + OutageBanner can share one declaration
 * without dragging server-only code into the client bundle.
 */

export interface MuniGroup {
  id: string | null;
  name: string;
  customers: number;
  feeders: number;
}

export interface RegionGroup {
  region: string;
  total_customers: number;
  total_feeders: number;
  municipalities: MuniGroup[];
}

export interface OutageSummary {
  total_customers: number;
  total_feeders: number;
  groups: RegionGroup[];
  fetched_at: string;
  reason?: "supabase_unconfigured" | "supabase_error" | "no_data";
  error?: string;
}
