import { NextResponse } from "next/server";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type {
  MuniGroup,
  OutageSummary,
  RegionGroup,
} from "@/lib/outages-summary-types";

export const dynamic = "force-dynamic";
export const revalidate = 60;

interface FeederRow {
  feeder_id: string;
  region: string | null;
  municipality_label: string | null;
  customers: number | null;
  status: string;
}

interface MunicipalityRef {
  id: string;
  name: string;
}

/**
 * Region order mirrors LUMA's 7-region division of the island. Order is fixed
 * (not alphabetical) so the sidebar reads the same way every refresh.
 */
const REGION_ORDER = [
  "San Juan",
  "Bayamón",
  "Carolina",
  "Caguas",
  "Mayagüez",
  "Ponce",
  "Arecibo",
];

function normalizeRegion(raw: string | null): string {
  if (!raw) return "Other";
  // Region feed sometimes uses "T&D San Juan" or all-caps; normalize.
  const cleaned = raw.replace(/^T&D\s+/i, "").trim();
  const upper = cleaned.toLowerCase();
  for (const canonical of REGION_ORDER) {
    if (canonical.toLowerCase() === upper) return canonical;
  }
  // Accent-insensitive fallback (Bayamon vs Bayamón, Mayaguez vs Mayagüez).
  const stripAccents = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  for (const canonical of REGION_ORDER) {
    if (stripAccents(canonical) === stripAccents(cleaned)) return canonical;
  }
  return cleaned || "Other";
}

export async function GET() {
  if (!isSupabaseConfigured()) {
    const body: OutageSummary = emptySummary("supabase_unconfigured");
    return NextResponse.json(body);
  }
  try {
    const supabase = getServerSupabase();
    const [feedersRes, munisRes] = await Promise.all([
      supabase
        .from("aeepr_feeder_latest")
        .select("feeder_id, region, municipality_label, customers, status, ts")
        .eq("status", "SI"),
      supabase.from("municipalities").select("id, name"),
    ]);

    if (feedersRes.error) throw new Error(feedersRes.error.message);

    const feeders = (feedersRes.data ?? []) as Array<FeederRow & { ts: string }>;
    const munis = (munisRes.data ?? []) as MunicipalityRef[];

    // name → id map, accent-insensitive for resilience to feeder label drift.
    const stripAccents = (s: string) =>
      s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    const muniByName = new Map<string, MunicipalityRef>();
    for (const m of munis) {
      muniByName.set(stripAccents(m.name), m);
    }

    // group region → muni → { customers, feeders }
    const byRegion = new Map<
      string,
      Map<string, { customers: number; feeders: number }>
    >();
    let totalCustomers = 0;
    let totalFeeders = 0;
    let newestTs = "";

    for (const f of feeders) {
      const region = normalizeRegion(f.region);
      const muniLabel = f.municipality_label?.trim() || "Unknown";
      const customers = typeof f.customers === "number" ? f.customers : 0;
      totalCustomers += customers;
      totalFeeders += 1;
      if (f.ts > newestTs) newestTs = f.ts;
      const regionMap = byRegion.get(region) ?? new Map();
      const cur = regionMap.get(muniLabel) ?? { customers: 0, feeders: 0 };
      cur.customers += customers;
      cur.feeders += 1;
      regionMap.set(muniLabel, cur);
      byRegion.set(region, regionMap);
    }

    const groups: RegionGroup[] = Array.from(byRegion.entries())
      .map(([region, muniMap]) => {
        const municipalities: MuniGroup[] = Array.from(muniMap.entries())
          .map(([name, agg]) => {
            const ref = muniByName.get(stripAccents(name));
            return {
              id: ref?.id ?? null,
              name: ref?.name ?? name,
              customers: agg.customers,
              feeders: agg.feeders,
            };
          })
          .sort((a, b) => b.customers - a.customers);
        const total_customers = municipalities.reduce(
          (sum, m) => sum + m.customers,
          0,
        );
        const total_feeders = municipalities.reduce(
          (sum, m) => sum + m.feeders,
          0,
        );
        return { region, total_customers, total_feeders, municipalities };
      })
      .sort((a, b) => {
        const ai = REGION_ORDER.indexOf(a.region);
        const bi = REGION_ORDER.indexOf(b.region);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return b.total_customers - a.total_customers;
      });

    const body: OutageSummary = {
      total_customers: totalCustomers,
      total_feeders: totalFeeders,
      groups,
      fetched_at: newestTs || new Date().toISOString(),
      reason: groups.length === 0 ? "no_data" : undefined,
    };
    return NextResponse.json(body, {
      headers: {
        "Cache-Control":
          "public, max-age=60, s-maxage=60, stale-while-revalidate=120",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "outages summary failed";
    const body: OutageSummary = {
      ...emptySummary("supabase_error"),
      error: message,
    };
    return NextResponse.json(body, { status: 500 });
  }
}

function emptySummary(reason: OutageSummary["reason"]): OutageSummary {
  return {
    total_customers: 0,
    total_feeders: 0,
    groups: [],
    fetched_at: new Date().toISOString(),
    reason,
  };
}
