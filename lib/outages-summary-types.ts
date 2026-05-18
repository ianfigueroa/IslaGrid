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
  /**
   * Customers-affected total from ~1h ago, used to render the trend chip on
   * the banner. null when there's no comparable snapshot (cold start, or
   * upstream changed schema).
   */
  total_customers_1h_ago: number | null;
  reason?: "supabase_unconfigured" | "supabase_error" | "no_data";
  error?: string;
}
