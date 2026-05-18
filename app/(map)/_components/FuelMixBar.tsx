"use client";

import { useEffect, useState } from "react";
import type { FuelMixPayload, FuelSlice } from "@/app/api/grid/fuel-mix/route";
import { FUEL_LABEL } from "@/lib/fuel-colors";

/**
 * Horizontal stacked bar showing the live fuel mix that's making the
 * island's MW right now. Slots into StatusPanel under the Demand / Gen /
 * Reserve telemetry, so users can see *what's running* — not just how much.
 *
 * Source-of-truth is /api/grid/fuel-mix, which sums plant_snapshots over
 * the freshest 30-min window. We don't fall back to a forecast or curated
 * shares — if no plant has reported in 30 min, the bar just hides.
 */
export function FuelMixBar() {
  const [data, setData] = useState<FuelMixPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/grid/fuel-mix", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as FuelMixPayload;
        if (!cancelled) setData(json);
      } catch {
        /* keep previous value */
      }
    };
    void load();
    const t = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  if (!data || data.slices.length === 0 || data.total_mw <= 0) return null;

  return (
    <section className="border-b border-line px-5 py-3.5">
      <header className="mb-2 flex items-baseline justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-3">
          Fuel mix
        </h3>
        <span className="text-[11px] tabular-nums text-text-2">
          {data.total_mw.toLocaleString()} MW total
        </span>
      </header>
      <div
        role="img"
        aria-label={`Fuel mix: ${data.slices
          .map((s) => `${FUEL_LABEL[s.fuel] ?? s.fuel} ${Math.round(s.share * 100)}%`)
          .join(", ")}`}
        className="flex h-2.5 w-full overflow-hidden rounded-full"
      >
        {data.slices.map((s) => (
          <span
            key={s.fuel}
            title={`${FUEL_LABEL[s.fuel] ?? s.fuel} · ${s.mw.toLocaleString()} MW · ${Math.round(
              s.share * 100,
            )}%`}
            style={{ width: `${s.share * 100}%`, backgroundColor: s.color }}
          />
        ))}
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        {data.slices.map((s) => (
          <SliceRow key={s.fuel} slice={s} />
        ))}
      </ul>
    </section>
  );
}

function SliceRow({ slice }: { slice: FuelSlice }) {
  return (
    <li className="flex items-center gap-1.5 text-text-2">
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: slice.color }}
      />
      <span className="truncate">{FUEL_LABEL[slice.fuel] ?? slice.fuel}</span>
      <span className="ml-auto font-mono tabular-nums text-text-3">
        {Math.round(slice.share * 100)}%
      </span>
    </li>
  );
}
