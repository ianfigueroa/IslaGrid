"use client";

import type { CauseBreakdown, CauseKey } from "@/lib/reliability";

interface Props {
  causeHours: CauseBreakdown;
}

const CAUSE_META: Record<
  CauseKey,
  { label: string; color: string }
> = {
  generation:   { label: "Generation",   color: "#ef4444" },
  distribution: { label: "Distribution", color: "#f59e0b" },
  weather:      { label: "Weather",      color: "#3b82f6" },
  planned:      { label: "Planned",      color: "#10b981" },
  unknown:      { label: "Unknown",      color: "#6b7280" },
};

const ORDER: CauseKey[] = ["generation", "distribution", "weather", "planned", "unknown"];

export function CauseBreakdownBar({ causeHours }: Props) {
  const total =
    causeHours.generation +
    causeHours.distribution +
    causeHours.weather +
    causeHours.planned +
    causeHours.unknown;

  if (total <= 0) {
    return (
      <section className="card grid place-items-center px-5 py-8 text-[12px] text-text-3">
        No outage hours to break down for this window.
      </section>
    );
  }

  return (
    <section className="card px-5 py-5">
      <header className="mb-3">
        <h3 className="text-[13px] font-semibold tracking-tight">
          Breakdown by cause
        </h3>
      </header>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2">
        {ORDER.map((k) => {
          const v = causeHours[k];
          if (v <= 0) return null;
          const pct = (v / total) * 100;
          return (
            <div
              key={k}
              style={{ width: `${pct}%`, backgroundColor: CAUSE_META[k].color }}
              title={`${CAUSE_META[k].label} — ${v.toFixed(1)}h (${pct.toFixed(0)}%)`}
            />
          );
        })}
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[12px] sm:grid-cols-3 md:grid-cols-5">
        {ORDER.map((k) => {
          const v = causeHours[k];
          if (v <= 0) return null;
          const pct = (v / total) * 100;
          return (
            <li key={k} className="flex items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: CAUSE_META[k].color }}
                aria-hidden
              />
              <span className="text-text-2">{CAUSE_META[k].label}</span>
              <span className="ml-auto tabular-nums text-text-3">
                {v.toFixed(1)}h ({Math.round(pct)}%)
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
