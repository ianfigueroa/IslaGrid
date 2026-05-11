import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { DEMO_MODE } from "@/lib/demo";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const revalidate = 300; // 5 min

type Status = "normal" | "watch" | "strained" | "critical" | "stale" | "unknown";

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

const DEMO_STATUS_BY_FIPS: Record<string, Status> = {
  "72127": "watch",     // San Juan
  "72013": "watch",     // Bayamón
  "72031": "strained",  // Carolina
  "72061": "watch",     // Guaynabo
  "72113": "watch",     // Ponce
  "72005": "watch",     // Aguadilla
  "72147": "strained",  // Vieques (typical outage island)
  "72049": "critical",  // Culebra
  "72097": "watch",     // Mayagüez
  "72057": "watch",     // Guayama
};

export async function GET() {
  const file = path.join(process.cwd(), "public", "geo", "pr-municipalities.geojson");
  const raw = await fs.readFile(file, "utf8");
  const fc = JSON.parse(raw) as {
    type: "FeatureCollection";
    features: Array<{
      type: "Feature";
      id: string | number;
      properties: { id: string; name: string; fips: string | null; population: number | null };
      geometry: GeoJSON.Geometry;
    }>;
  };

  // Default everything to "normal"
  const statusByFips = new Map<string, Status>();
  const plannedByFips = new Map<string, { count: number; latest: string | null }>();

  if (DEMO_MODE) {
    for (const [fips, s] of Object.entries(DEMO_STATUS_BY_FIPS)) {
      statusByFips.set(fips, s);
    }
    plannedByFips.set("72127", { count: 3, latest: new Date(Date.now() - 1000 * 60 * 18).toISOString() });
    plannedByFips.set("72031", { count: 1, latest: new Date(Date.now() - 1000 * 60 * 95).toISOString() });
    plannedByFips.set("72147", { count: 2, latest: new Date(Date.now() - 1000 * 60 * 220).toISOString() });
  } else {
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
          // 3+ active items = watch; 5+ = strained
          const s = cur.count >= 5 ? "strained" : cur.count >= 3 ? "watch" : "normal";
          statusByFips.set(id, s);
        }
      }
    } catch {
      /* fall through with empty maps; map will render all-normal */
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
        status: statusByFips.get(fips) ?? "normal",
        planned_work_count: planned?.count ?? 0,
        last_planned_work_ts: planned?.latest ?? null,
      };
      return { ...f, properties: props };
    }),
  };

  return NextResponse.json(enriched, {
    headers: {
      "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
