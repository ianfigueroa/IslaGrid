"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MapPin, Sun } from "lucide-react";
import type { MunicipalityHistory } from "@/lib/reliability";
import { RangePicker, type RangeKey } from "./RangePicker";
import { ReliabilityScore } from "./ReliabilityScore";
import { MetricTiles } from "./MetricTiles";
import { OutageCalendar } from "./OutageCalendar";
import { MonthlyHoursChart } from "./MonthlyHoursChart";
import { CauseBreakdownBar } from "./CauseBreakdownBar";

interface Props {
  municipalityId: string;
  municipalityName: string;
}

interface HistoryResponse {
  history?: MunicipalityHistory;
  reason?: string;
  error?: string;
}

/**
 * Client wrapper around the per-municipality history view. Owns the range
 * picker state and re-fetches /api/.../history when the user changes window.
 *
 * Renders above the existing forward-looking MunicipalityScorecard so the
 * page reads: history first ("here's the past year"), then the live + risk
 * snapshot below.
 */
export function HistoryPanel({ municipalityId, municipalityName }: Props) {
  const [range, setRange] = useState<RangeKey>("365d");
  const [data, setData] = useState<MunicipalityHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const load = async () => {
      try {
        const res = await fetch(
          `/api/municipalities/${encodeURIComponent(municipalityId)}/history?window=${range}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as HistoryResponse;
        if (cancelled) return;
        if (json.reason === "supabase_unconfigured") {
          setError("Historical data unavailable — Supabase not configured.");
          setData(null);
        } else if (json.history) {
          setData(json.history);
        } else {
          setError(json.error ?? "No history returned.");
        }
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load history.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [municipalityId, range]);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <MapPin className="size-5 text-brand" aria-hidden />
          <h1 className="text-[26px] font-semibold tracking-tight">
            {municipalityName}
          </h1>
        </div>
        <RangePicker value={range} onChange={setRange} />
      </header>

      {error ? (
        <div className="card px-5 py-4 text-[13px] text-text-3">{error}</div>
      ) : null}

      {data ? (
        <>
          <ReliabilityScore
            percentile={data.percentile}
            totalHours={data.total_hours}
            islandMedianHours={data.island_median_hours}
          />
          <MetricTiles
            totalOutages={data.total_outages}
            totalHours={data.total_hours}
            avgDurationMin={data.avg_duration_min}
            longestHours={data.longest_hours}
            mainCause={data.main_cause}
            annualCostUsd={data.annual_cost_usd}
          />
          <OutageCalendar data={data.calendar} />
          <MonthlyHoursChart data={data.monthly} />
          <CauseBreakdownBar causeHours={data.cause_hours} />

          {data.annual_cost_usd > 0 ? (
            <Link
              href={`/solar?annualOutageCostUsd=${data.annual_cost_usd}`}
              className="group card flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:border-brand"
            >
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-full bg-brand-soft text-brand">
                  <Sun className="size-4" aria-hidden />
                </span>
                <div className="leading-tight">
                  <div className="text-[13px] font-semibold text-text">
                    Based on your outage exposure, you could save up to{" "}
                    ${data.annual_cost_usd.toLocaleString()}/year with solar + battery.
                  </div>
                  <div className="text-[11.5px] text-text-3">
                    Uses your last 12 months of estimated outage hours.
                  </div>
                </div>
              </div>
              <span className="rounded-full bg-brand px-3 py-1.5 text-[12px] font-semibold text-white">
                Calculate savings →
              </span>
            </Link>
          ) : null}

          {data.source_path === "live_aggregate" ? (
            <p className="text-[10.5px] text-text-3">
              Live aggregate from outage events — pre-computed rollup not yet
              populated for this municipality.
            </p>
          ) : data.source_path === "empty" ? (
            <p className="text-[10.5px] text-text-3">
              No outage records yet for the selected window. As LUMA and PREB
              publish more events, this view will fill in automatically.
            </p>
          ) : null}
        </>
      ) : loading ? (
        <div className="card grid place-items-center px-5 py-12 text-[13px] text-text-3">
          Loading reliability history…
        </div>
      ) : null}
    </div>
  );
}
