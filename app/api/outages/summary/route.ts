import { NextResponse } from "next/server";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type {
  MuniGroup,
  OutageSummary,
  RegionGroup,
} from "@/lib/outages-summary-types";

export const dynamic = "force-dynamic";
// LUMA's regions feed lands every ~5 min; cache for 30s so the banner and
// panel reflect a new push within one client poll cycle.
export const revalidate = 30;

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

interface LumaRegionRow {
  region_id: string;
  region_name: string;
  customers_affected: number | null;
  customers_served: number | null;
  source_last_updated_at: string | null;
  ts: string;
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
    // LUMA's regions feed is the authoritative customer-count source — it
    // matches miluma.lumapr.com/outages/status exactly. AEEPR feeder rows are
    // the per-municipality breakdown when present, but their `status='SI'`
    // filter goes empty between feeder pushes; we used to read only AEEPR and
    // the banner would lie about "0 customers" while LUMA showed thousands.
    // For the trend chip on the banner we also pull the snapshot closest to
    // 1h ago. Window is 50–70 min so a slightly late ingest still picks
    // something up.
    const oneHourAgoStart = new Date(Date.now() - 70 * 60 * 1000).toISOString();
    const oneHourAgoEnd = new Date(Date.now() - 50 * 60 * 1000).toISOString();
    const [lumaRes, feedersRes, munisRes, historyRes] = await Promise.all([
      supabase
        .from("luma_outage_latest")
        .select(
          "region_id, region_name, customers_affected, customers_served, source_last_updated_at, ts",
        ),
      supabase
        .from("aeepr_feeder_latest")
        .select("feeder_id, region, municipality_label, customers, status, ts")
        .eq("status", "SI"),
      supabase.from("municipalities").select("id, name"),
      supabase
        .from("luma_outage_snapshots")
        .select("ts, customers_affected")
        .gte("ts", oneHourAgoStart)
        .lte("ts", oneHourAgoEnd),
    ]);

    if (lumaRes.error) throw new Error(lumaRes.error.message);

    const lumaRegions = (lumaRes.data ?? []) as LumaRegionRow[];
    const feeders = (feedersRes.data ?? []) as Array<FeederRow & { ts: string }>;
    const munis = (munisRes.data ?? []) as MunicipalityRef[];

    const stripAccents = (s: string) =>
      s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    const muniByName = new Map<string, MunicipalityRef>();
    for (const m of munis) {
      muniByName.set(stripAccents(m.name), m);
    }

    // Per-region muni rollup from AEEPR feeders (when available).
    const feederByRegion = new Map<
      string,
      Map<string, { customers: number; feeders: number }>
    >();
    let feederTotalFeeders = 0;
    let feederNewestTs = "";

    for (const f of feeders) {
      const region = normalizeRegion(f.region);
      const muniLabel = f.municipality_label?.trim() || "Unknown";
      const customers = typeof f.customers === "number" ? f.customers : 0;
      feederTotalFeeders += 1;
      if (f.ts > feederNewestTs) feederNewestTs = f.ts;
      const regionMap = feederByRegion.get(region) ?? new Map();
      const cur = regionMap.get(muniLabel) ?? { customers: 0, feeders: 0 };
      cur.customers += customers;
      cur.feeders += 1;
      regionMap.set(muniLabel, cur);
      feederByRegion.set(region, regionMap);
    }

    // Build region groups from LUMA totals, attaching the feeder-derived muni
    // breakdown if any exists for that region.
    const seenRegions = new Set<string>();
    let totalCustomers = 0;
    let lumaNewestTs = "";

    const groups: RegionGroup[] = lumaRegions
      .map((r) => {
        const region = normalizeRegion(r.region_name);
        seenRegions.add(region);
        const customers_affected =
          typeof r.customers_affected === "number" ? r.customers_affected : 0;
        totalCustomers += customers_affected;
        if (r.ts > lumaNewestTs) lumaNewestTs = r.ts;
        const muniMap = feederByRegion.get(region);
        const municipalities: MuniGroup[] = muniMap
          ? Array.from(muniMap.entries())
              .map(([name, agg]) => {
                const ref = muniByName.get(stripAccents(name));
                return {
                  id: ref?.id ?? null,
                  name: ref?.name ?? name,
                  customers: agg.customers,
                  feeders: agg.feeders,
                };
              })
              .sort((a, b) => b.customers - a.customers)
          : [];
        const total_feeders = municipalities.reduce(
          (sum, m) => sum + m.feeders,
          0,
        );
        return {
          region,
          total_customers: customers_affected,
          total_feeders,
          municipalities,
        };
      })
      // Fold in any AEEPR regions LUMA hasn't reported on (rare, but keeps
      // us from silently dropping data).
      .concat(
        Array.from(feederByRegion.entries())
          .filter(([region]) => !seenRegions.has(region))
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
            totalCustomers += total_customers;
            return { region, total_customers, total_feeders, municipalities };
          }),
      )
      .sort((a, b) => {
        const ai = REGION_ORDER.indexOf(a.region);
        const bi = REGION_ORDER.indexOf(b.region);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return b.total_customers - a.total_customers;
      });

    const newestTs = lumaNewestTs || feederNewestTs || new Date().toISOString();
    // Sum the 1h-ago snapshot across regions. If the window has multiple
    // ingest cycles, bucket by closest ts to the midpoint to avoid mixing
    // two different snapshots.
    const historyRows = (historyRes.data ?? []) as Array<{
      ts: string;
      customers_affected: number | null;
    }>;
    let total_customers_1h_ago: number | null = null;
    if (historyRows.length > 0) {
      // Group by ts (each snapshot writes one row per region at the same ts),
      // then pick the bucket with the most regions (= most complete snapshot).
      const byTs = new Map<string, number>();
      for (const r of historyRows) {
        byTs.set(
          r.ts,
          (byTs.get(r.ts) ?? 0) +
            (typeof r.customers_affected === "number" ? r.customers_affected : 0),
        );
      }
      // Pick the snapshot with the highest total (proxy for "complete").
      // Ties broken by latest ts.
      let best: { ts: string; total: number } | null = null;
      for (const [ts, total] of byTs.entries()) {
        if (!best || total > best.total || (total === best.total && ts > best.ts)) {
          best = { ts, total };
        }
      }
      total_customers_1h_ago = best?.total ?? null;
    }
    const body: OutageSummary = {
      total_customers: totalCustomers,
      total_feeders: feederTotalFeeders,
      groups,
      fetched_at: newestTs,
      total_customers_1h_ago,
      reason: groups.length === 0 ? "no_data" : undefined,
    };
    return NextResponse.json(body, {
      headers: {
        "Cache-Control":
          "public, max-age=30, s-maxage=30, stale-while-revalidate=60",
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
    total_customers_1h_ago: null,
    reason,
  };
}
