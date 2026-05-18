import type { Metadata } from "next";
import { getServerSupabase, isSupabaseConfigured, type GridSnapshot } from "@/lib/supabase";
import { CURATED_PLANTS } from "@/lib/plants";
import { listMunicipalities } from "@/lib/scorecards";
import { SubPageHeader } from "@/app/_components/SubPageHeader";
import { IslandTotals } from "./_components/IslandTotals";
import { PlantsTable, type PlantRow } from "./_components/PlantsTable";
import { ForecastTable, type ForecastRow } from "./_components/ForecastTable";

export const dynamic = "force-dynamic";
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Grid dashboard — IslaGrid",
  description:
    "Live generation per plant, island demand, and the next-6h outage forecast for every Puerto Rico municipality.",
};

// Mirrors the name normalizer in /api/plants so we collapse plant_snapshots
// rows onto the curated nameplate list without "Aguirre" leaking into
// "Aguirre Solar" or similar near-misses.
function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/\b(power\s+plant|planta|central|cc|gt|thermal)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface PlantSnapshotRow {
  plant_name: string;
  category: string | null;
  output_mw: number | string | null;
  ts: string;
}

interface PredictionRow {
  municipality_id: string;
  probability: number | null;
  horizon: string;
}

interface RiskRow {
  municipality_id: string;
  band: "low" | "elevated" | "high" | "severe" | "unknown" | null;
  risk_score: number | null;
  reasons: string[] | null;
}

async function loadDashboard(): Promise<{
  snapshot: GridSnapshot | null;
  plants: PlantRow[];
  forecast: ForecastRow[];
  trained: boolean;
}> {
  if (!isSupabaseConfigured()) {
    return { snapshot: null, plants: [], forecast: [], trained: false };
  }
  const sb = getServerSupabase();
  const munis = await listMunicipalities();
  const muniById = new Map(munis.map((m) => [m.id, m] as const));

  // 6h snapshot window is enough to drive the "freshness" pill and the
  // "running now" output column. We don't need 24h of detail here — the
  // map popup already shows per-plant sparklines.
  const since6h = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

  const [snapRes, plantsRes, predRes, riskRes] = await Promise.all([
    sb
      .from("grid_snapshots")
      .select(
        "ts, current_demand_mw, next_hour_demand_mw, total_generation_mw, available_capacity_mw, spinning_reserve_mw, operational_reserve_mw, peak_demand_forecast_mw, peak_reserve_forecast_mw, status, status_reasons, source, source_stale",
      )
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from("plant_snapshots")
      .select("plant_name, category, output_mw, ts")
      .gte("ts", since6h)
      .order("ts", { ascending: false })
      .limit(5000),
    sb
      .from("outage_predictions_latest")
      .select("municipality_id, probability, horizon")
      .eq("horizon", "6h"),
    sb
      .from("municipality_risk_latest")
      .select("municipality_id, band, risk_score, reasons"),
  ]);

  const snapshot = (snapRes.data ?? null) as GridSnapshot | null;

  // Roll plant_snapshots up onto the curated fleet. For each plant we keep
  // the freshest ts and sum any same-ts category rows (so e.g. San Juan's
  // base + peak units report as one combined output).
  const latestByPlant = new Map<
    string,
    { mw: number; ts: string }
  >();
  for (const row of (plantsRes.data ?? []) as PlantSnapshotRow[]) {
    const key = normName(String(row.plant_name ?? ""));
    if (!key) continue;
    const mw = Number(row.output_mw);
    if (!Number.isFinite(mw)) continue;
    const existing = latestByPlant.get(key);
    if (!existing || row.ts > existing.ts) {
      latestByPlant.set(key, { mw, ts: row.ts });
      continue;
    }
    if (row.ts === existing.ts) {
      existing.mw += mw;
    }
  }

  // Fuels Genera PR doesn't publish gauges for. Those plants will never get
  // a hit in latestByPlant, so we render "no feed" rather than implying the
  // station is offline. AES/EcoEléctrica (private IPPs) ARE published.
  const NO_FEED_FUELS = new Set(["solar", "wind", "hydro", "landfill", "battery"]);

  const plants: PlantRow[] = CURATED_PLANTS.map((p) => {
    // Two-pass match: exact normalized name first, then prefix/contains so a
    // curated "AES Puerto Rico (Guayama)" matches the bare "AES" gauge title
    // Genera publishes. Mirrors the loose match in /api/plants/[id].
    const target = normName(p.name);
    let hit = latestByPlant.get(target);
    if (!hit) {
      for (const [k, v] of latestByPlant) {
        if (k && (target.startsWith(k) || k.startsWith(target))) {
          hit = v;
          break;
        }
      }
    }
    const current_mw = hit?.mw ?? null;
    const ts = hit?.ts ?? null;
    const utilization_pct =
      current_mw != null && p.capacity_mw > 0
        ? Math.max(0, Math.min(110, (current_mw / p.capacity_mw) * 100))
        : null;
    // Status tiers:
    //   no_feed → Genera doesn't expose this fuel (solar/wind/etc.); not a bug
    //   idle    → diesel peaker we DO scrape but it just isn't running now
    //   offline → baseload (gas/oil/coal) with a recent zero reading
    //   derated → producing under 25% of nameplate
    //   online  → producing 25%+ of nameplate
    const status: PlantRow["status"] = (() => {
      if (current_mw == null) {
        if (NO_FEED_FUELS.has(p.fuel)) return "no_feed";
        if (p.fuel === "diesel") return "idle";
        return "unknown";
      }
      if (current_mw <= 0) return "offline";
      if (utilization_pct != null && utilization_pct < 25) return "derated";
      return "online";
    })();
    return {
      id: p.id,
      name: p.name,
      operator: p.operator,
      fuel: p.fuel,
      capacity_mw: p.capacity_mw,
      current_mw,
      utilization_pct,
      status,
      ts,
    };
  });

  const predictionByMuni = new Map<string, number>();
  for (const row of (predRes.data ?? []) as PredictionRow[]) {
    if (typeof row.probability === "number") {
      predictionByMuni.set(row.municipality_id, row.probability);
    }
  }
  const riskByMuni = new Map<string, RiskRow>();
  for (const row of (riskRes.data ?? []) as RiskRow[]) {
    riskByMuni.set(row.municipality_id, row);
  }

  const forecast: ForecastRow[] = munis.map((m) => {
    const r = riskByMuni.get(m.id);
    return {
      id: m.id,
      name: m.name,
      population: m.population,
      probability_6h: predictionByMuni.get(m.id) ?? null,
      band: (r?.band ?? "unknown") as ForecastRow["band"],
      risk_score: r?.risk_score ?? null,
      top_reason: r?.reasons?.[0] ?? null,
    };
  });

  // The forecast table tells the user whether the ML model is real yet. As
  // soon as we have any prediction sourced from LightGBM (vs the heuristic
  // fallback), we flip the badge — for now infer from non-null probability
  // count, since outage_predictions_latest is the join target either way.
  const trained = forecast.filter((f) => f.probability_6h != null).length > 0;

  return { snapshot, plants, forecast, trained };
}

export default async function GridDashboardPage() {
  const { snapshot, plants, forecast, trained } = await loadDashboard();

  return (
    <div className="min-h-dvh bg-bg text-text">
      <SubPageHeader title="Grid dashboard" />
      <main className="px-4 py-8 sm:px-8">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
          <header>
            <h1 className="text-[24px] font-semibold tracking-tight">
              Live grid dashboard
            </h1>
            <p className="mt-1 text-sm text-text-2">
              Every generating station on the island with its current output,
              plus the next-6 hour outage forecast for all 78 municipalities.
            </p>
          </header>

          <IslandTotals snapshot={snapshot} />

          <section className="flex flex-col gap-3">
            <header className="flex items-baseline justify-between">
              <h2 className="text-[16px] font-semibold tracking-tight">
                Generating stations
              </h2>
              <span className="text-[11px] text-text-3">
                {plants.filter((p) => p.current_mw != null).length} of{" "}
                {plants.length} reporting
              </span>
            </header>
            <PlantsTable plants={plants} />
          </section>

          <section className="flex flex-col gap-3">
            <header className="flex items-baseline justify-between gap-3">
              <h2 className="text-[16px] font-semibold tracking-tight">
                6-hour outage forecast
              </h2>
              <span
                className={
                  "rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider " +
                  (trained
                    ? "bg-warn/15 text-warn"
                    : "bg-surface-2 text-text-3")
                }
                title={
                  trained
                    ? "Predictions sourced from the latest model run."
                    : "No predictions yet — the ML model is still gated until enough labels accumulate."
                }
              >
                {trained ? "Live model" : "Heuristic fallback"}
              </span>
            </header>
            <ForecastTable rows={forecast} />
          </section>

          <p className="text-[11px] text-text-3">
            Plant output: <code>plant_snapshots</code> via Genera PR · refreshed
            every ~5 min. Forecast: <code>outage_predictions_latest</code>{" "}
            joined with <code>municipality_risk_latest</code>. Click any
            municipality to open its scorecard.
          </p>
        </div>
      </main>
    </div>
  );
}
