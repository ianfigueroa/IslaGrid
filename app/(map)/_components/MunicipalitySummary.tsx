"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Wrench, AlertTriangle, Info as InfoIcon } from "lucide-react";
import { StatusPill } from "./StatusPill";
import { FreshnessChip } from "./FreshnessChip";
import type { SourceId } from "@/lib/sources";
import type { GridStatus } from "@/lib/supabase";

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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`/api/municipalities/${encodeURIComponent(municipalityId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => {
        if (!cancelled) setData(j as Summary);
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
