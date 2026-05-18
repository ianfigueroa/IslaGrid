import type { Metadata } from "next";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { listMunicipalities } from "@/lib/scorecards";
import { SubPageHeader } from "@/app/_components/SubPageHeader";
import { MunicipalitiesDirectory } from "./_components/MunicipalitiesDirectory";

export const dynamic = "force-dynamic";
export const revalidate = 60;

export const metadata: Metadata = {
  title: "All municipalities — IslaGrid",
  description:
    "Reliability scorecard for every Puerto Rico municipality. Search, sort, and jump straight to a neighborhood detail page.",
};

interface RiskRow {
  municipality_id: string;
  band: "low" | "elevated" | "high" | "severe" | "unknown" | null;
  risk_score: number | null;
}

interface OutageBucket {
  municipality_id: string;
  outage_hours: number;
}

async function loadDirectoryData() {
  const munis = await listMunicipalities();
  if (!isSupabaseConfigured()) {
    return { munis, risk: new Map<string, RiskRow>(), recent: new Map<string, number>() };
  }
  const supa = getServerSupabase();
  const since30dDay = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const since30dIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  // Aggregate-history runs hourly. When it's catching up (or has just been
  // wiped after a dedup pass), the rollup table is sparse. Fall back to
  // live event durations so the directory doesn't render a sea of "—".
  const [riskRes, dailyRes, eventRes] = await Promise.all([
    supa
      .from("municipality_risk_latest")
      .select("municipality_id, band, risk_score"),
    supa
      .from("municipality_outage_daily")
      .select("municipality_id, outage_hours")
      .gte("day", since30dDay),
    supa
      .from("outage_events")
      .select("municipality_id, started_at, ended_at")
      .gte("started_at", since30dIso)
      .limit(5000),
  ]);
  const risk = new Map<string, RiskRow>();
  for (const row of (riskRes.data ?? []) as RiskRow[]) {
    risk.set(row.municipality_id, row);
  }
  const recent = new Map<string, number>();
  for (const row of (dailyRes.data ?? []) as OutageBucket[]) {
    recent.set(
      row.municipality_id,
      (recent.get(row.municipality_id) ?? 0) + (row.outage_hours ?? 0),
    );
  }
  // Live fallback: only fill munis the rollup didn't cover. Hours per event =
  // (ended_at ?? now) - started_at, clamped to >= 0. Matches the eventHours
  // helper in lib/reliability.ts so the two read-paths stay consistent.
  const nowMs = Date.now();
  for (const row of (eventRes.data ?? []) as Array<{
    municipality_id: string | null;
    started_at: string;
    ended_at: string | null;
  }>) {
    const mid = row.municipality_id;
    if (!mid || recent.has(mid)) continue;
    const start = new Date(row.started_at).getTime();
    const end = row.ended_at ? new Date(row.ended_at).getTime() : nowMs;
    const hrs = Math.max(0, (end - start) / (1000 * 60 * 60));
    recent.set(mid, (recent.get(mid) ?? 0) + hrs);
  }
  return { munis, risk, recent };
}

export default async function MunicipalitiesIndexPage() {
  const { munis, risk, recent } = await loadDirectoryData();
  const items = munis.map((m) => {
    const r = risk.get(m.id);
    return {
      id: m.id,
      name: m.name,
      population: m.population,
      band: (r?.band ?? "unknown") as
        | "low"
        | "elevated"
        | "high"
        | "severe"
        | "unknown",
      score: r?.risk_score ?? null,
      hours30d: recent.get(m.id) ?? 0,
    };
  });

  return (
    <div className="min-h-dvh bg-bg text-text">
      <SubPageHeader title="Every municipality" />
      <main className="px-4 py-10 sm:px-8">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
          <header>
            <h1 className="text-[22px] font-semibold tracking-tight">
              All 78 municipalities
            </h1>
            <p className="mt-1 text-sm text-text-2">
              Live risk band, 30-day outage hours, and population for every
              muni on the island. Tap any row to open its scorecard.
            </p>
          </header>
          <MunicipalitiesDirectory items={items} />
          <p className="text-[11px] text-text-3">
            Risk band: heuristic-v2 · refreshed every 30 min. Outage hours:
            rolling sum from <code>municipality_outage_daily</code>. Missing
            history fills in as the aggregate-history cron catches up.
          </p>
        </div>
      </main>
    </div>
  );
}
