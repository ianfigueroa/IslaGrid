import { NextResponse } from "next/server";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { CURATED_PLANTS } from "@/lib/plants";

export const dynamic = "force-dynamic";
// Genera scrapes every ~5 min; cache for 30s so StatusPanel renders the
// freshest possible fuel split without re-hitting Supabase on every open.
export const revalidate = 30;

export interface FuelSlice {
  fuel: string;
  mw: number;
  share: number;
  color: string;
}

export interface FuelMixPayload {
  total_mw: number;
  ts: string | null;
  slices: FuelSlice[];
  reason?: "supabase_unconfigured" | "no_snapshot" | "supabase_error";
}

// Match the FUEL_COLOR palette in GridMap.tsx so legend swatches and the
// stacked bar use the same hues. Kept inline rather than importing from a
// client component to avoid pulling MapLibre into the API route bundle.
const FUEL_COLOR: Record<string, string> = {
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

function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/\b(power\s+plant|planta|central|cc|gt|thermal)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface SnapshotRow {
  plant_name: string | null;
  output_mw: number | string | null;
  ts: string;
}

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json<FuelMixPayload>({
      total_mw: 0,
      ts: null,
      slices: [],
      reason: "supabase_unconfigured",
    });
  }
  try {
    const supabase = getServerSupabase();
    // 30-min lookback is plenty — Genera updates every ~5 min, and if a
    // plant hasn't reported in 30 min we'd rather omit it than smear a stale
    // value into the live mix.
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("plant_snapshots")
      .select("plant_name, output_mw, ts")
      .gte("ts", since)
      .order("ts", { ascending: false })
      .limit(2000);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as SnapshotRow[];
    if (rows.length === 0) {
      return NextResponse.json<FuelMixPayload>({
        total_mw: 0,
        ts: null,
        slices: [],
        reason: "no_snapshot",
      });
    }

    // For each plant_name, sum the unit categories at the newest ts. Then map
    // plant_name → fuel via the curated list.
    const newestTsByPlant = new Map<string, string>();
    for (const r of rows) {
      if (!r.plant_name) continue;
      const cur = newestTsByPlant.get(r.plant_name);
      if (!cur || r.ts > cur) newestTsByPlant.set(r.plant_name, r.ts);
    }
    const mwByPlant = new Map<string, number>();
    let snapshotTs: string | null = null;
    for (const r of rows) {
      if (!r.plant_name) continue;
      if (r.ts !== newestTsByPlant.get(r.plant_name)) continue;
      const mw = Number(r.output_mw) || 0;
      mwByPlant.set(r.plant_name, (mwByPlant.get(r.plant_name) ?? 0) + mw);
      if (!snapshotTs || r.ts > snapshotTs) snapshotTs = r.ts;
    }

    const mwByFuel = new Map<string, number>();
    for (const [plantName, mw] of mwByPlant.entries()) {
      const target = normName(plantName);
      const curated = CURATED_PLANTS.find((p) => {
        const n = normName(p.name);
        return n === target || target.startsWith(n) || n.startsWith(target);
      });
      const fuel = curated?.fuel ?? "unknown";
      mwByFuel.set(fuel, (mwByFuel.get(fuel) ?? 0) + mw);
    }

    const total = Array.from(mwByFuel.values()).reduce((s, v) => s + v, 0);
    const slices: FuelSlice[] = Array.from(mwByFuel.entries())
      // Hide tiny zeros so a 0.1 MW landfill plant doesn't get a stripe.
      .filter(([, mw]) => mw >= 1)
      .map(([fuel, mw]) => ({
        fuel,
        mw: Math.round(mw),
        share: total > 0 ? mw / total : 0,
        color: FUEL_COLOR[fuel] ?? FUEL_COLOR.unknown,
      }))
      .sort((a, b) => b.mw - a.mw);

    return NextResponse.json<FuelMixPayload>(
      {
        total_mw: Math.round(total),
        ts: snapshotTs,
        slices,
      },
      {
        headers: {
          "Cache-Control":
            "public, max-age=30, s-maxage=30, stale-while-revalidate=60",
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "fuel mix failed";
    return NextResponse.json<FuelMixPayload>(
      {
        total_mw: 0,
        ts: null,
        slices: [],
        reason: "supabase_error",
      },
      { status: 500, headers: { "x-error": message } },
    );
  }
}
