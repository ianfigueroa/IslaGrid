import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { DEMO_MODE } from "@/lib/demo";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const revalidate = 60;

interface PlannedWorkRow {
  id: string;
  area: string | null;
  work_type: string | null;
  start_ts: string | null;
  end_ts: string | null;
  possible_interruption: boolean | null;
  source_url: string | null;
}

interface Summary {
  id: string;
  name: string;
  fips: string | null;
  population: number | null;
  status: "normal" | "watch" | "strained" | "critical" | "stale" | "unknown";
  planned_work: PlannedWorkRow[];
  source: "lumapr.com" | "datos.pr.gov" | "demo";
  source_label: "official" | "estimated" | "community" | "unverified";
  as_of: string;
  notes: string[];
}

function demoSummary(id: string, name: string, population: number | null): Summary {
  const now = Date.now();
  const samples: Record<string, Summary> = {
    "72127": {
      id, name, fips: id, population,
      status: "watch",
      source: "demo", source_label: "official",
      as_of: new Date(now - 1000 * 60 * 12).toISOString(),
      planned_work: [
        { id: "pw-1", area: "Hato Rey · Ave. Ponce de León", work_type: "Substation maintenance", start_ts: new Date(now + 1000 * 60 * 60 * 18).toISOString(), end_ts: new Date(now + 1000 * 60 * 60 * 24).toISOString(), possible_interruption: true,  source_url: "https://lumapr.com/trabajos-planificados/" },
        { id: "pw-2", area: "Santurce · Calle Loíza",        work_type: "Pole replacement",      start_ts: new Date(now + 1000 * 60 * 60 * 36).toISOString(), end_ts: new Date(now + 1000 * 60 * 60 * 40).toISOString(), possible_interruption: false, source_url: "https://lumapr.com/trabajos-planificados/" },
        { id: "pw-3", area: "Río Piedras · Universidad",     work_type: "Line clearance",        start_ts: new Date(now + 1000 * 60 * 60 * 8 ).toISOString(), end_ts: new Date(now + 1000 * 60 * 60 * 12).toISOString(), possible_interruption: true,  source_url: "https://lumapr.com/trabajos-planificados/" },
      ],
      notes: [
        "3 active planned-work items in the next 36 hours",
        "Interruption possible during morning windows",
      ],
    },
    "72049": {
      id, name, fips: id, population,
      status: "critical",
      source: "demo", source_label: "official",
      as_of: new Date(now - 1000 * 60 * 5).toISOString(),
      planned_work: [],
      notes: [
        "Submarine cable repair in progress — generator-only supply",
        "Expect intermittent service until 18:00 AST",
      ],
    },
    "72147": {
      id, name, fips: id, population,
      status: "strained",
      source: "demo", source_label: "official",
      as_of: new Date(now - 1000 * 60 * 22).toISOString(),
      planned_work: [
        { id: "pw-v1", area: "Isabel Segunda",     work_type: "Generator maintenance", start_ts: new Date(now + 1000 * 60 * 60 * 6).toISOString(), end_ts: new Date(now + 1000 * 60 * 60 * 10).toISOString(), possible_interruption: true, source_url: "https://lumapr.com/trabajos-planificados/" },
        { id: "pw-v2", area: "Esperanza · Coastal", work_type: "Line repair",          start_ts: new Date(now + 1000 * 60 * 60 * 30).toISOString(), end_ts: new Date(now + 1000 * 60 * 60 * 34).toISOString(), possible_interruption: false, source_url: "https://lumapr.com/trabajos-planificados/" },
      ],
      notes: [
        "Island grid running on local generation",
        "Two planned-work items in the next 36 hours",
      ],
    },
  };
  const tpl = samples[id];
  if (tpl) return tpl;
  return {
    id, name, fips: id, population,
    status: "normal",
    source: "demo", source_label: "official",
    as_of: new Date(now - 1000 * 60 * 6).toISOString(),
    planned_work: [],
    notes: [
      "No active planned-work items in the next 72 hours",
      "Grid status: stable per latest LUMA System Overview",
    ],
  };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const file = path.join(process.cwd(), "public", "geo", "pr-municipalities.geojson");
  const raw = await fs.readFile(file, "utf8");
  const fc = JSON.parse(raw) as {
    features: Array<{ properties: { id: string; name: string; fips: string | null; population: number | null } }>;
  };
  const feat = fc.features.find((f) => f.properties.id === id || f.properties.fips === id);
  if (!feat) return NextResponse.json({ error: "Municipality not found" }, { status: 404 });

  if (DEMO_MODE) {
    return NextResponse.json(
      demoSummary(feat.properties.id, feat.properties.name, feat.properties.population),
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=120" } },
    );
  }

  const supa = await getServerSupabase();
  const { data: rows } = await supa
    .from("planned_work")
    .select("id, area, work_type, start_ts, end_ts, possible_interruption, source_url, scraped_at")
    .eq("municipality_id", feat.properties.id)
    .gte("end_ts", new Date().toISOString())
    .order("start_ts", { ascending: true })
    .limit(10);

  const planned: PlannedWorkRow[] = (rows ?? []).map((r) => ({
    id: String(r.id),
    area: r.area,
    work_type: r.work_type,
    start_ts: r.start_ts,
    end_ts: r.end_ts,
    possible_interruption: r.possible_interruption,
    source_url: r.source_url,
  }));

  const status: Summary["status"] =
    planned.length >= 5 ? "strained" : planned.length >= 3 ? "watch" : "normal";
  const latest = (rows ?? [])
    .map((r) => r.scraped_at ?? r.start_ts ?? null)
    .filter(Boolean)
    .sort()
    .pop() as string | undefined;

  const summary: Summary = {
    id: feat.properties.id,
    name: feat.properties.name,
    fips: feat.properties.fips,
    population: feat.properties.population,
    status,
    source: "lumapr.com",
    source_label: "official",
    as_of: latest ?? new Date().toISOString(),
    planned_work: planned,
    notes:
      planned.length === 0
        ? ["No active planned-work items reported by LUMA."]
        : [
            `${planned.length} active planned-work item${planned.length === 1 ? "" : "s"} in scope.`,
          ],
  };

  return NextResponse.json(summary, {
    headers: { "Cache-Control": "public, max-age=60, s-maxage=120" },
  });
}
