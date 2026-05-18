"use client";

import { Activity, Clock, DollarSign, Flame, TrendingDown, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CauseKey } from "@/lib/reliability";

interface Props {
  totalOutages: number;
  totalHours: number;
  avgDurationMin: number;
  longestHours: number;
  mainCause: CauseKey;
  annualCostUsd: number;
}

const CAUSE_LABEL: Record<CauseKey, string> = {
  generation: "Generation",
  distribution: "Distribution",
  weather: "Weather",
  planned: "Planned",
  unknown: "Unknown",
};

export function MetricTiles({
  totalOutages,
  totalHours,
  avgDurationMin,
  longestHours,
  mainCause,
  annualCostUsd,
}: Props) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Tile
        Icon={Zap}
        iconClass="text-crit"
        label="Total outages"
        value={totalOutages.toLocaleString()}
      />
      <Tile
        Icon={Clock}
        iconClass="text-warn"
        label="Hours without power"
        value={`${formatHours(totalHours)}h`}
      />
      <Tile
        Icon={Activity}
        iconClass="text-text-2"
        label="Average duration"
        value={formatMinutes(avgDurationMin)}
      />
      <Tile
        Icon={TrendingDown}
        iconClass="text-crit"
        label="Longest outage"
        value={`${formatHours(longestHours)}h`}
      />
      <Tile
        Icon={Flame}
        iconClass="text-warn"
        label="Main cause"
        value={CAUSE_LABEL[mainCause]}
      />
      <Tile
        Icon={DollarSign}
        iconClass="text-ok"
        label="Estimated annual cost"
        value={`$${annualCostUsd.toLocaleString()}`}
      />
    </div>
  );
}

interface TileProps {
  Icon: LucideIcon;
  iconClass: string;
  label: string;
  value: string;
}

function Tile({ Icon, iconClass, label, value }: TileProps) {
  return (
    <div className="card flex flex-col gap-2 px-4 py-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-text-3">
        <Icon className={`size-3.5 ${iconClass}`} aria-hidden />
        <span>{label}</span>
      </div>
      <div className="text-[22px] font-semibold tracking-tight text-text tabular-nums">
        {value}
      </div>
    </div>
  );
}

function formatHours(h: number): string {
  if (h >= 100) return Math.round(h).toLocaleString();
  return h.toFixed(1);
}

function formatMinutes(min: number): string {
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  return `${h}h ${m}m`;
}
