import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demandPressure } from "@/lib/demand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 300;

interface MuniProps {
  id: string;
  name: string;
  fips: string | null;
  population: number | null;
}

/**
 * EXPERIMENTAL — see lib/demand.ts header. Returns a per-municipality
 * "pressure" indicator, NOT megawatts. The UI must label this clearly.
 *
 * We approximate population density by dividing population by a hardcoded
 * island-wide average area until we ingest per-municipality area; this is
 * intentionally coarse and the v0 disclaimer covers it.
 */
const AVG_MUNI_AREA_KM2 = 116; // PR is ~9,100 km² / 78 munis ≈ 116 km²/muni avg

export async function GET() {
  const file = path.join(
    process.cwd(),
    "public",
    "geo",
    "pr-municipalities.geojson",
  );
  const raw = await fs.readFile(file, "utf8");
  const fc = JSON.parse(raw) as {
    features: Array<{ properties: MuniProps }>;
  };

  // Island-wide stress proxy: reserve_margin pct. Lower margin → higher stress.
  let islandStress = 0.3;
  const weatherByMuni = new Map<string, number>();
  if (isSupabaseConfigured()) {
    try {
      const supa = getServerSupabase();
      const [{ data: grid }, { data: weather }] = await Promise.all([
        supa
          .from("grid_snapshots")
          .select(
            "current_demand_mw, available_capacity_mw, operational_reserve_mw, status",
          )
          .order("ts", { ascending: false })
          .limit(1)
          .maybeSingle(),
        // Latest temperature per municipality
        supa
          .from("weather_snapshots")
          .select("municipality_id, ts, temp_c")
          .order("ts", { ascending: false })
          .limit(2000),
      ]);
      if (grid && grid.available_capacity_mw && grid.current_demand_mw) {
        const margin =
          (grid.available_capacity_mw - grid.current_demand_mw) /
          grid.available_capacity_mw;
        islandStress = Math.max(0, Math.min(1, 1 - margin * 4));
        if (grid.status === "strained") islandStress = Math.max(islandStress, 0.65);
        if (grid.status === "critical") islandStress = Math.max(islandStress, 0.9);
      }
      for (const row of weather ?? []) {
        const id = row.municipality_id as string | null;
        if (!id || weatherByMuni.has(id)) continue;
        if (typeof row.temp_c === "number") weatherByMuni.set(id, row.temp_c);
      }
    } catch {
      /* fall through with defaults */
    }
  }

  // PR is UTC-4 (Atlantic Standard Time, no DST).
  const now = new Date();
  const localHour = (now.getUTCHours() + 24 - 4) % 24;

  const features = fc.features.map((f) => {
    const props = f.properties;
    const density = props.population
      ? props.population / AVG_MUNI_AREA_KM2
      : 0;
    const temp = weatherByMuni.get(props.id) ?? null;
    const result = demandPressure({
      populationDensity: density,
      temperatureC: temp,
      localHour,
      islandGridStress: islandStress,
    });
    return {
      municipality_id: props.id,
      name: props.name,
      ...result,
    };
  });

  return NextResponse.json(
    {
      items: features,
      computed_at: now.toISOString(),
      local_hour: localHour,
      island_stress: islandStress,
      notice:
        "EXPERIMENTAL — relative demand pressure proxy, not megawatts. " +
        "See lib/demand.ts for methodology.",
      source: "islagrid-heuristic",
    },
    {
      headers: {
        "Cache-Control":
          "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
      },
    },
  );
}
