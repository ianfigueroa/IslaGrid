"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { cn } from "@/lib/cn";

export interface DirectoryItem {
  id: string;
  name: string;
  population: number | null;
  band: "low" | "elevated" | "high" | "severe" | "unknown";
  score: number | null;
  hours30d: number;
}

type SortKey = "name" | "band" | "hours";

const BAND_ORDER: Record<DirectoryItem["band"], number> = {
  severe: 0,
  high: 1,
  elevated: 2,
  low: 3,
  unknown: 4,
};

const BAND_TONE: Record<DirectoryItem["band"], string> = {
  severe: "border-crit/30 bg-crit-soft text-crit",
  high: "border-warn/40 bg-warn-soft text-warn",
  elevated: "border-warn/30 bg-warn-soft text-warn",
  low: "border-ok/30 bg-ok-soft text-ok",
  unknown: "border-line bg-surface-2 text-text-3",
};

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function fmtHours(h: number): string {
  if (h <= 0) return "—";
  if (h < 1) return `${h.toFixed(1)} h`;
  return `${Math.round(h).toLocaleString()} h`;
}

export function MunicipalitiesDirectory({ items }: { items: DirectoryItem[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("name");

  const filtered = useMemo(() => {
    const q = stripAccents(query.trim());
    const base = q
      ? items.filter((m) => stripAccents(m.name).includes(q))
      : items;
    return [...base].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "band") {
        const diff = BAND_ORDER[a.band] - BAND_ORDER[b.band];
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
      }
      // hours desc
      const diff = b.hours30d - a.hours30d;
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    });
  }, [items, query, sort]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex min-w-[14rem] flex-1 items-center">
          <Search className="pointer-events-none absolute left-3 size-4 text-text-3" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Vieques, Bayamón, Yauco…"
            className="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-text placeholder:text-text-3 focus:border-brand focus:outline-none"
            aria-label="Search municipalities"
          />
        </label>
        <div role="group" aria-label="Sort by" className="flex h-11 items-center gap-1 rounded-xl border border-line bg-surface px-1">
          {(["name", "band", "hours"] as SortKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setSort(k)}
              aria-pressed={sort === k}
              className={cn(
                "h-9 rounded-lg px-3 text-[12px] font-medium transition-colors",
                sort === k
                  ? "bg-brand text-white"
                  : "text-text-2 hover:bg-surface-2 hover:text-text",
              )}
            >
              {k === "name" ? "A–Z" : k === "band" ? "Risk" : "30d hours"}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-6 text-center text-sm text-text-3">
          No municipality matches “{query}”.
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {filtered.map((m) => (
            <li key={m.id}>
              <Link
                href={`/m/${m.id}`}
                className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium text-text">
                    {m.name}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-text-3">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                        BAND_TONE[m.band],
                      )}
                    >
                      {m.band}
                    </span>
                    {m.population != null ? (
                      <span>{m.population.toLocaleString()} residents</span>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end text-right">
                  <span className="font-mono text-[13px] tabular-nums text-text">
                    {fmtHours(m.hours30d)}
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.16em] text-text-3">
                    30d out
                  </span>
                </div>
                <ChevronRight className="size-4 shrink-0 text-text-3" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
