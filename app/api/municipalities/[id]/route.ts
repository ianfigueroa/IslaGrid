import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";

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
  source: "lumapr.com" | "datos.pr.gov" | "no_data";
  source_label: "official" | "estimated" | "community" | "unverified";
  as_of: string | null;
  notes: string[];
  reason?: "supabase_unconfigured" | "ingest_pending" | "supabase_error";
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const file = path.join(
    process.cwd(),
    "public",
    "geo",
    "pr-municipalities.geojson",
  );
  const raw = await fs.readFile(file, "utf8");
  const fc = JSON.parse(raw) as {
    features: Array<{
      properties: {
        id: string;
        name: string;
        fips: string | null;
        population: number | null;
      };
    }>;
  };
  const feat = fc.features.find(
    (f) => f.properties.id === id || f.properties.fips === id,
  );
  if (!feat)
    return NextResponse.json({ error: "Municipality not found" }, { status: 404 });

  if (!isSupabaseConfigured()) {
    const summary: Summary = {
      id: feat.properties.id,
      name: feat.properties.name,
      fips: feat.properties.fips,
      population: feat.properties.population,
      status: "unknown",
      source: "no_data",
      source_label: "estimated",
      as_of: null,
      planned_work: [],
      notes: ["Supabase is not configured in this environment."],
      reason: "supabase_unconfigured",
    };
    return NextResponse.json(summary);
  }

  const supa = await getServerSupabase();
  const [plannedRes, riskRes] = await Promise.all([
    supa
      .from("planned_work")
      .select(
        "id, area, work_type, start_ts, end_ts, possible_interruption, source_url, scraped_at",
      )
      .eq("municipality_id", feat.properties.id)
      .gte("end_ts", new Date().toISOString())
      .order("start_ts", { ascending: true })
      .limit(10),
    supa
      .from("municipality_risk_latest")
      .select("band")
      .eq("municipality_id", feat.properties.id)
      .maybeSingle<{ band: string }>(),
  ]);
  const { data: rows, error } = plannedRes;

  if (error) {
    const summary: Summary = {
      id: feat.properties.id,
      name: feat.properties.name,
      fips: feat.properties.fips,
      population: feat.properties.population,
      status: "unknown",
      source: "no_data",
      source_label: "estimated",
      as_of: null,
      planned_work: [],
      notes: ["Supabase query failed."],
      reason: "supabase_error",
    };
    return NextResponse.json(summary);
  }

  const planned: PlannedWorkRow[] = (rows ?? []).map((r) => ({
    id: String(r.id),
    area: r.area,
    work_type: r.work_type,
    start_ts: r.start_ts,
    end_ts: r.end_ts,
    possible_interruption: r.possible_interruption,
    source_url: r.source_url,
  }));

  // Planned-work load is the primary status signal — lots of crews dispatched
  // to one muni reads as strained. When no planned work is on file, fall back
  // to the heuristic risk band so we don't display a bare "Unknown" while
  // the risk model has a real opinion.
  const riskBand = riskRes.data?.band ?? null;
  const RISK_TO_STATUS: Record<string, Summary["status"]> = {
    low: "normal",
    elevated: "watch",
    high: "strained",
    severe: "critical",
  };
  const status: Summary["status"] =
    planned.length >= 5
      ? "strained"
      : planned.length >= 3
        ? "watch"
        : planned.length >= 1
          ? "normal"
          : riskBand
            ? (RISK_TO_STATUS[riskBand] ?? "unknown")
            : "unknown";
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
    source: planned.length > 0 ? "lumapr.com" : "no_data",
    source_label: "official",
    as_of: latest ?? null,
    planned_work: planned,
    reason: planned.length === 0 ? "ingest_pending" : undefined,
    notes:
      planned.length === 0
        ? [
            "No active planned-work items ingested for this municipality.",
            "Ingestion runs every 15 minutes from lumapr.com/mejorasplanificadas/.",
          ]
        : [
            `${planned.length} active planned-work item${planned.length === 1 ? "" : "s"} in scope.`,
          ],
  };

  return NextResponse.json(summary, {
    headers: { "Cache-Control": "public, max-age=60, s-maxage=120" },
  });
}
