"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Wrench, AlertTriangle, Info as InfoIcon, TriangleAlert } from "lucide-react";
import { StatusPill } from "./StatusPill";
import { FreshnessChip } from "./FreshnessChip";
import type { SourceId } from "@/lib/sources";
import type { GridStatus } from "@/lib/supabase";

interface RiskRow {
  municipality_id: string;
  ts: string;
  risk_score: number;
  band: "low" | "elevated" | "high" | "severe" | "unknown";
  reasons: string[];
  feature_freshness_s: number;
  source: string;
}

interface PredictionRow {
  municipality_id: string;
  horizon: "1h" | "6h" | "12h" | "24h";
  probability: number;
  confidence_band: "low" | "medium" | "high";
  top_factors: Array<{ label: string; weight: number }>;
  model_version: string;
  feature_freshness_s: number;
}

const BAND_TONE: Record<RiskRow["band"], string> = {
  low:      "border-ok/30 bg-ok-soft text-ok",
  elevated: "border-warn/30 bg-warn-soft text-warn",
  high:     "border-warn/40 bg-warn-soft text-warn",
  severe:   "border-crit/40 bg-crit-soft text-crit",
  unknown:  "border-line bg-surface-2 text-text-3",
};

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
  status: GridStatus;
  planned_work: PlannedWorkRow[];
  source: "lumapr.com" | "datos.pr.gov" | "demo";
  source_label: "official" | "estimated" | "community" | "unverified";
  as_of: string;
  notes: string[];
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    weekday: "short", hour: "numeric", minute: "2-digit", hour12: true,
  });
}

interface Props {
  municipalityId: string;
}

export function MunicipalitySummary({ municipalityId }: Props) {
  const [data, setData] = useState<Summary | null>(null);
  const [risk, setRisk] = useState<RiskRow | null>(null);
  const [prediction, setPrediction] = useState<PredictionRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setRisk(null);
    setPrediction(null);
    setError(null);
    void Promise.all([
      fetch(`/api/municipalities/${encodeURIComponent(municipalityId)}`).then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)),
      ),
      fetch("/api/risk/municipalities").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/predictions/outage").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([summary, riskResp, predResp]) => {
        if (cancelled) return;
        setData(summary as Summary);
        const row = (riskResp as { items?: RiskRow[] } | null)?.items?.find(
          (r) => r.municipality_id === municipalityId,
        );
        setRisk(row ?? null);
        const pred = (predResp as { items?: PredictionRow[] } | null)?.items?.find(
          (p) => p.municipality_id === municipalityId,
        );
        setPrediction(pred ?? null);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message ?? e));
      });
    return () => {
      cancelled = true;
    };
  }, [municipalityId]);

  if (error) {
    return (
      <div className="rounded-md border border-line bg-surface-2 p-3 text-xs text-text-2">
        Unable to load this municipality right now ({error}).
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-2">
        <div className="h-5 w-32 animate-pulse rounded bg-surface-2" />
        <div className="h-4 w-48 animate-pulse rounded bg-surface-2" />
        <div className="h-20 w-full animate-pulse rounded bg-surface-2" />
      </div>
    );
  }

  const sourceId: SourceId = data.source === "datos.pr.gov" ? "datos.pr.gov" : "lumapr.com";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={data.status} />
        <FreshnessChip asOf={data.as_of} source={sourceId} />
      </div>

      {data.population != null ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <div>
            <dt className="uppercase tracking-[0.12em] text-text-3">Population</dt>
            <dd className="font-mono text-sm text-text">
              {data.population.toLocaleString("en-US")}
            </dd>
          </div>
          {data.fips ? (
            <div>
              <dt className="uppercase tracking-[0.12em] text-text-3">FIPS</dt>
              <dd className="font-mono text-sm text-text">{data.fips}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {risk ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-text-3">
            <span>Outage risk · 6h horizon</span>
            <span className="font-mono normal-case tracking-normal text-text-2">
              IslaGrid heuristic
            </span>
          </div>
          <div
            className={`flex items-center justify-between rounded-md border px-2.5 py-1.5 ${BAND_TONE[risk.band]}`}
          >
            <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider">
              <TriangleAlert className="size-3.5" aria-hidden />
              {risk.band}
            </span>
            <span className="font-mono text-sm tabular-nums">
              {risk.risk_score.toFixed(0)} / 100
            </span>
          </div>
          {risk.reasons.length > 0 ? (
            <ul className="space-y-1 text-xs text-text-2">
              {risk.reasons.slice(0, 3).map((r, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="mt-1 inline-block size-1 shrink-0 rounded-full bg-text-3" aria-hidden />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-[10px] text-text-3">
            Estimated · features {Math.round(risk.feature_freshness_s / 60)} min old · not a prediction of certainty.
          </p>
        </div>
      ) : null}

      {prediction ? (
        <div className="space-y-1.5 rounded-md border border-line bg-surface-2 p-2.5">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-text-3">
            <span>Model prediction · {prediction.horizon}</span>
            <span className="font-mono normal-case tracking-normal text-text-2">
              {prediction.model_version.startsWith("heuristic")
                ? "heuristic fallback"
                : `model ${prediction.model_version.slice(0, 8)}`}
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-xl tabular-nums text-text">
              {(prediction.probability * 100).toFixed(0)}%
            </span>
            <span className="text-[10px] uppercase tracking-wider text-text-3">
              confidence · {prediction.confidence_band}
            </span>
          </div>
          {prediction.top_factors.length > 0 ? (
            <ul className="space-y-1 text-xs text-text-2">
              {prediction.top_factors.slice(0, 3).map((f, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="mt-1 inline-block size-1 shrink-0 rounded-full bg-text-3" aria-hidden />
                  <span>{f.label}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-[10px] text-text-3">
            Estimated · features {Math.round(prediction.feature_freshness_s / 60)} min old · probability clipped to [5%, 95%].
          </p>
        </div>
      ) : null}

      {data.notes.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-[0.16em] text-text-3">Summary</div>
          <ul className="space-y-1.5 text-xs text-text-2">
            {data.notes.map((n, i) => (
              <li key={i} className="flex items-start gap-2">
                <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-text-3" aria-hidden />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-text-3">
          <span>Planned work (LUMA)</span>
          <span className="font-mono normal-case tracking-normal text-text-2">
            {data.planned_work.length}
          </span>
        </div>
        {data.planned_work.length === 0 ? (
          <p className="text-xs text-text-3">
            No active planned-work items reported for this municipality.
          </p>
        ) : (
          <ul className="space-y-2">
            {data.planned_work.map((w) => (
              <li
                key={w.id}
                className="rounded-md border border-line bg-surface-2 p-2.5 text-xs"
              >
                <div className="flex items-start gap-2">
                  <Wrench className="mt-0.5 size-3.5 shrink-0 text-text-3" aria-hidden />
                  <div className="flex-1">
                    <div className="font-medium text-text">{w.work_type ?? "Scheduled work"}</div>
                    {w.area ? <div className="text-text-2">{w.area}</div> : null}
                    <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] text-text-3">
                      <span>{fmtTime(w.start_ts)}</span>
                      <span aria-hidden>→</span>
                      <span>{fmtTime(w.end_ts)}</span>
                    </div>
                    {w.possible_interruption ? (
                      <div className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-warn/30 bg-warn/10 px-1.5 py-0.5 text-[10px] text-warn">
                        <AlertTriangle className="size-3" aria-hidden />
                        Interruption possible
                      </div>
                    ) : null}
                    {w.source_url ? (
                      <a
                        href={w.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-text-2 underline-offset-2 hover:text-text hover:underline"
                      >
                        Source <ExternalLink className="size-3" aria-hidden />
                      </a>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="border-t border-line pt-3 text-[10px] text-text-3">
        Data joined from LUMA Planned Work, OpenStreetMap administrative boundaries, and the
        grid status heuristic. Informational — not for operational decisions.
      </p>
    </div>
  );
}
