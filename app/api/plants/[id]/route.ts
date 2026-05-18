import { NextResponse } from "next/server";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { CURATED_PLANTS } from "@/lib/plants";
import { normName } from "@/lib/plant-naming";

export const dynamic = "force-dynamic";
// Genera scrapes every ~5 min; cache for 20s so the popover refreshes inside
// the user's attention window without re-hitting Supabase on every click.
export const revalidate = 20;

interface SnapshotRow {
  plant_name: string;
  category: string | null;
  output_mw: number | string | null;
  ts: string;
}

interface PlantDetail {
  id: string;
  name: string;
  fuel?: string | null;
  operator?: string | null;
  capacity_mw?: number | null;
  current_mw: number | null;
  available_mw: number | null;
  status: "online" | "offline" | "derated" | "unknown";
  utilization_pct: number | null;
  units: Array<{ category: string | null; mw: number; ts: string }>;
  /**
   * 24h history of summed output for the plant, oldest first. Points are
   * deduplicated by ts (multiple unit rows at the same ts are summed) and
   * thinned to ~50 points so the sparkline stays cheap to render.
   */
  history_24h: Array<{ ts: string; mw: number }>;
  ts: string | null;
  matched: boolean;
  reason?:
    | "supabase_unconfigured"
    | "no_snapshot"
    | "unknown_plant"
    | "supabase_error";
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const decodedId = decodeURIComponent(id);
  const curated = CURATED_PLANTS.find((p) => p.id === decodedId);
  const displayName = curated?.name ?? decodedId;

  if (!isSupabaseConfigured()) {
    const body: PlantDetail = {
      id: decodedId,
      name: displayName,
      fuel: curated?.fuel ?? null,
      operator: curated?.operator ?? null,
      capacity_mw: curated?.capacity_mw ?? null,
      current_mw: null,
      available_mw: null,
      status: "unknown",
      utilization_pct: null,
      units: [],
      history_24h: [],
      ts: null,
      matched: false,
      reason: "supabase_unconfigured",
    };
    return NextResponse.json(body);
  }

  try {
    const supabase = getServerSupabase();
    // Pull 24h worth of plant_snapshots — Genera scrapes every ~5 min so 24h
    // is ~288 ticks per plant, well under the 5k row limit even when 25
    // plants are stored together.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("plant_snapshots")
      .select("plant_name, category, output_mw, ts")
      .gte("ts", since)
      .order("ts", { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);

    const target = normName(displayName);
    const rows = (data ?? []) as SnapshotRow[];
    // Prefer exact normalized match — prefix-only matching is a fallback so
    // we don't accidentally fuse two distinct plants whose names happen to
    // share a leading token (e.g. "Aguirre" + "Aguirre Solar").
    let matching = rows.filter(
      (row) => normName(String(row.plant_name ?? "")) === target,
    );
    if (matching.length === 0) {
      matching = rows.filter((row) => {
        const n = normName(String(row.plant_name ?? ""));
        if (!n) return false;
        return target.startsWith(n) || n.startsWith(target);
      });
    }

    if (matching.length === 0) {
      const body: PlantDetail = {
        id: decodedId,
        name: displayName,
        fuel: curated?.fuel ?? null,
        operator: curated?.operator ?? null,
        capacity_mw: curated?.capacity_mw ?? null,
        current_mw: null,
        available_mw: null,
        status: "unknown",
        utilization_pct: null,
        units: [],
        history_24h: [],
        ts: null,
        matched: false,
        reason: "no_snapshot",
      };
      return NextResponse.json(body, {
        headers: {
          "Cache-Control":
            "public, max-age=20, s-maxage=20, stale-while-revalidate=60",
        },
      });
    }

    // Newest ts wins; multiple categories with the same ts get summed.
    const newestTs = matching.reduce(
      (best, r) => (r.ts > best ? r.ts : best),
      matching[0].ts,
    );
    const currentUnits = matching.filter((r) => r.ts === newestTs);
    const units = currentUnits.map((r) => ({
      category: r.category,
      mw: Number(r.output_mw) || 0,
      ts: r.ts,
    }));
    const current_mw = units.reduce((sum, u) => sum + u.mw, 0);

    // Build the 24h history: sum unit categories at each timestamp, sort
    // ascending, then thin to ~50 points so the sparkline stays cheap.
    const summedByTs = new Map<string, number>();
    for (const row of matching) {
      const mw = Number(row.output_mw) || 0;
      summedByTs.set(row.ts, (summedByTs.get(row.ts) ?? 0) + mw);
    }
    const orderedHistory = Array.from(summedByTs.entries())
      .map(([ts, mw]) => ({ ts, mw }))
      .sort((a, b) => (a.ts < b.ts ? -1 : 1));
    const targetPoints = 50;
    const history_24h =
      orderedHistory.length <= targetPoints
        ? orderedHistory
        : orderedHistory.filter(
            (_, i) =>
              i % Math.ceil(orderedHistory.length / targetPoints) === 0 ||
              i === orderedHistory.length - 1,
          );
    const capacity = curated?.capacity_mw ?? null;
    const utilization_pct =
      capacity && capacity > 0
        ? Math.max(0, Math.min(100, (current_mw / capacity) * 100))
        : null;
    // Status tiers: zero output → offline; output < 25% nameplate → derated;
    // anything else → online. When we don't have a curated capacity figure,
    // utilization_pct is null, so any positive output reads "online" rather
    // than guessing at a derated threshold against unknown nameplate.
    const status: PlantDetail["status"] =
      current_mw <= 0
        ? "offline"
        : utilization_pct != null && utilization_pct < 25
          ? "derated"
          : "online";

    const body: PlantDetail = {
      id: decodedId,
      name: displayName,
      fuel: curated?.fuel ?? null,
      operator: curated?.operator ?? null,
      capacity_mw: capacity,
      current_mw,
      available_mw: capacity,
      status,
      utilization_pct,
      units,
      history_24h,
      ts: newestTs,
      matched: true,
    };
    return NextResponse.json(body, {
      headers: {
        "Cache-Control":
          "public, max-age=20, s-maxage=20, stale-while-revalidate=60",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "plant lookup failed";
    const body: PlantDetail = {
      id: decodedId,
      name: displayName,
      current_mw: null,
      available_mw: null,
      status: "unknown",
      utilization_pct: null,
      units: [],
      history_24h: [],
      ts: null,
      matched: false,
      reason: "supabase_error",
    };
    return NextResponse.json(
      { ...body, error: message },
      { status: 500 },
    );
  }
}
