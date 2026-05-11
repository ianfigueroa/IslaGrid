import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";

export const runtime = "nodejs";
export const revalidate = 300; // 5 min

type Status =
  | "normal"
  | "watch"
  | "strained"
  | "critical"
  | "stale"
  | "unknown";

interface MunicipalityProps {
  id: string;
  name: string;
  fips: string | null;
  population: number | null;
  status: Status;
  /** Count of currently-active planned-work items in this municipality */
  planned_work_count: number;
  /** ISO timestamp of latest planned-work entry, or null */
  last_planned_work_ts: string | null;
}

function statusForCount(count: number): Status {
  if (count >= 5) return "strained";
  if (count >= 3) return "watch";
  if (count >= 1) return "normal";
  return "unknown";
}

export async function GET() {
  const file = path.join(
    process.cwd(),
    "public",
    "geo",
    "pr-municipalities.geojson",
  );
  const raw = await fs.readFile(file, "utf8");
  const fc = JSON.parse(raw) as {
    type: "FeatureCollection";
    features: Array<{
      type: "Feature";
      id: string | number;
      properties: {
        id: string;
        name: string;
        fips: string | null;
        population: number | null;
      };
      geometry: GeoJSON.Geometry;
    }>;
  };

  const plannedByFips = new Map<
    string,
    { count: number; latest: string | null }
  >();

  if (isSupabaseConfigured()) {
    try {
      const supa = await getServerSupabase();
      const { data } = await supa
        .from("planned_work")
        .select("municipality_id, start_ts, end_ts, scraped_at")
        .gte("end_ts", new Date().toISOString());
      if (Array.isArray(data)) {
        for (const row of data) {
          const id = row.municipality_id as string | null;
          if (!id) continue;
          const cur = plannedByFips.get(id) ?? { count: 0, latest: null };
          cur.count += 1;
          const ts = row.scraped_at ?? row.start_ts;
          if (ts && (!cur.latest || ts > cur.latest)) cur.latest = ts;
          plannedByFips.set(id, cur);
        }
      }
    } catch {
      /* fall through with empty maps; map will render all-unknown */
    }
  }

  const enriched = {
    type: "FeatureCollection" as const,
    features: fc.features.map((f) => {
      const fips = (f.properties.fips ?? f.properties.id) as string;
      const planned = plannedByFips.get(fips);
      const props: MunicipalityProps = {
        id: f.properties.id,
        name: f.properties.name,
        fips: f.properties.fips,
        population: f.properties.population,
        status: statusForCount(planned?.count ?? 0),
        planned_work_count: planned?.count ?? 0,
        last_planned_work_ts: planned?.latest ?? null,
      };
      return { ...f, properties: props };
    }),
  };

  return NextResponse.json(enriched, {
    headers: {
      "Cache-Control":
        "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
