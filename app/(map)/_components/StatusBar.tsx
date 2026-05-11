"use client";

import { Zap } from "lucide-react";
import type { GridSnapshot } from "@/lib/supabase";
import { StatusPill } from "./StatusPill";
import { TelemetryCard } from "./TelemetryCard";
import { ThemeToggle } from "./ThemeToggle";

interface Props {
  snapshot: GridSnapshot | null;
  onStatusClick?: () => void;
}

export function StatusBar({ snapshot, onStatusClick }: Props) {
  const status = snapshot?.status ?? "unknown";
  const source = (snapshot?.source as "datos.pr.gov" | "lumapr.com") ?? "lumapr.com";
  const asOf = snapshot?.ts ?? new Date().toISOString();

  return (
    <header className="surface pointer-events-auto absolute inset-x-0 top-0 z-30 flex h-14 items-center gap-4 px-4">
      <div className="flex items-center gap-2 pr-3 border-r border-line">
        <Zap className="size-4 text-brand" aria-hidden />
        <span className="font-mono text-sm tracking-tight text-text">
          IslaGrid<span className="text-text-3">/PR</span>
        </span>
      </div>

      <StatusPill status={status} onClick={snapshot ? onStatusClick : undefined} />

      <div className="hidden md:flex flex-1 items-center divide-x divide-line overflow-x-auto">
        <TelemetryCard
          label="Demand"
          value={snapshot?.current_demand_mw}
          asOf={asOf}
          source={source}
        />
        <TelemetryCard
          label="Generation"
          value={snapshot?.total_generation_mw}
          asOf={asOf}
          source={source}
        />
        <TelemetryCard
          label="Reserves"
          value={snapshot?.operational_reserve_mw}
          asOf={asOf}
          source={source}
          tone={
            (snapshot?.operational_reserve_mw ?? 0) <
            (snapshot?.current_demand_mw ?? 0) * 0.05
              ? "warn"
              : "ok"
          }
        />
        <TelemetryCard
          label="Next-hour demand"
          value={snapshot?.next_hour_demand_mw}
          asOf={asOf}
          source={source}
          tone="neutral"
        />
      </div>

      <div className="ml-auto flex items-center gap-3">
        <span className="hidden text-[11px] font-mono text-text-3 lg:inline">
          Informational — not for operational decisions
        </span>
        <ThemeToggle />
      </div>
    </header>
  );
}
