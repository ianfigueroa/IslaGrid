"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";

const BAND_LABEL: Record<string, string> = {
  low: "Low",
  elevated: "Elevated",
  high: "High",
  severe: "Severe",
  unknown: "—",
};

const BAND_TONE: Record<string, string> = {
  low: "bg-ok/15 text-ok",
  elevated: "bg-warn/15 text-warn",
  high: "bg-warn/25 text-warn",
  severe: "bg-crit/20 text-crit",
  unknown: "bg-surface-2 text-text-3",
};

const BAND_ORDER: Record<string, number> = {
  severe: 4,
  high: 3,
  elevated: 2,
  low: 1,
  unknown: 0,
};

export interface ForecastRow {
  id: string;
  name: string;
  population: number | null;
  probability_6h: number | null;
  band: "low" | "elevated" | "high" | "severe" | "unknown";
  risk_score: number | null;
  top_reason: string | null;
}

type SortKey = "name" | "probability" | "band" | "population";

interface Props {
  rows: ForecastRow[];
}

export function ForecastTable({ rows }: Props) {
  const [sort, setSort] = useState<SortKey>("probability");
  const [dir, setDir] = useState<1 | -1>(-1);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return rows;
    const q = query.trim().toLowerCase();
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, query]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      const cmp = (() => {
        switch (sort) {
          case "name":
            return a.name.localeCompare(b.name);
          case "probability":
            return (a.probability_6h ?? -1) - (b.probability_6h ?? -1);
          case "band":
            return BAND_ORDER[a.band] - BAND_ORDER[b.band];
          case "population":
            return (a.population ?? 0) - (b.population ?? 0);
        }
      })();
      return cmp * dir;
    });
    return copy;
  }, [filtered, sort, dir]);

  function toggle(key: SortKey) {
    if (key === sort) {
      setDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSort(key);
      setDir(key === "name" ? 1 : -1);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line">
      <div className="flex items-center gap-3 border-b border-line bg-surface px-3 py-2.5">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter municipalities…"
          aria-label="Filter municipalities"
          className="h-8 flex-1 rounded-md bg-surface-2 px-2.5 text-[13px] text-text outline-none placeholder:text-text-3 focus-visible:ring-2 focus-visible:ring-brand"
        />
        <span className="text-[11px] text-text-3">
          {sorted.length} of {rows.length}
        </span>
      </div>
      <table className="w-full text-[13px]">
        <thead className="bg-surface/60 text-[11px] uppercase tracking-wider text-text-3">
          <tr>
            <Th onClick={() => toggle("name")} active={sort === "name"} dir={dir}>
              Municipality
            </Th>
            <Th
              onClick={() => toggle("probability")}
              active={sort === "probability"}
              dir={dir}
              align="right"
            >
              6h probability
            </Th>
            <Th onClick={() => toggle("band")} active={sort === "band"} dir={dir}>
              Risk band
            </Th>
            <th className="px-3 py-2.5 text-left font-semibold">Top driver</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {sorted.map((r) => (
            <tr
              key={r.id}
              className="bg-surface/30 transition-colors hover:bg-surface-2"
            >
              <td className="px-3 py-2.5">
                <Link
                  href={`/m/${r.id}`}
                  className="flex flex-col leading-tight hover:text-brand"
                >
                  <span className="font-medium text-text">{r.name}</span>
                  {r.population ? (
                    <span className="text-[11px] text-text-3">
                      {r.population.toLocaleString()} residents
                    </span>
                  ) : null}
                </Link>
              </td>
              <td className="px-3 py-2.5">
                <ProbBar pct={r.probability_6h} muniName={r.name} />
              </td>
              <td className="px-3 py-2.5">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-medium",
                    BAND_TONE[r.band],
                  )}
                >
                  {BAND_LABEL[r.band]}
                </span>
              </td>
              <td className="px-3 py-2.5 text-text-2">
                {r.top_reason ? (
                  <span className="line-clamp-1">{r.top_reason}</span>
                ) : (
                  <span className="text-text-3">—</span>
                )}
              </td>
            </tr>
          ))}
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-3 py-10 text-center text-text-3">
                No matches.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  onClick,
  active,
  dir,
  align = "left",
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  dir: 1 | -1;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={cn(
        "px-3 py-2.5 font-semibold",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:text-text",
          active ? "text-text" : "",
        )}
      >
        {children}
        {active ? (
          <span aria-hidden className="text-[9px]">
            {dir === 1 ? "▲" : "▼"}
          </span>
        ) : null}
      </button>
    </th>
  );
}

function ProbBar({
  pct,
  muniName,
}: {
  pct: number | null;
  muniName: string;
}) {
  if (pct == null) {
    return (
      <div className="flex items-center justify-end">
        <span className="text-[11px] text-text-3">—</span>
      </div>
    );
  }
  const value = Math.max(0, Math.min(1, pct));
  const tone =
    value >= 0.5
      ? "bg-crit"
      : value >= 0.25
        ? "bg-warn"
        : value >= 0.1
          ? "bg-warn/60"
          : "bg-ok";
  // Tooltip: explicit decimal probability + horizon for users hovering.
  // The fractional value (e.g. 0.196) is what the model actually emitted;
  // the rounded percentage on screen rounds it for at-a-glance scanning.
  const tooltip = `${muniName}: ${(value * 100).toFixed(1)}% chance of an outage event in the next 6 hours`;
  return (
    <div className="flex items-center justify-end gap-2" title={tooltip}>
      <div className="relative h-1.5 w-24 overflow-hidden rounded-full bg-surface-2">
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-[width] duration-300",
            tone,
          )}
          style={{ width: `${value * 100}%` }}
        />
      </div>
      <span className="w-10 text-right text-[12px] tabular-nums text-text-2">
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}
