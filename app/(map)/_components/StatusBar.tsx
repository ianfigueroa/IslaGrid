"use client";

import { Activity, ChevronRight } from "lucide-react";
import type { GridSnapshot } from "@/lib/supabase";
import { cn } from "@/lib/cn";

interface Props {
  snapshot: GridSnapshot | null;
  onStatusClick?: () => void;
}

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  normal:   { label: "Operating normally", tone: "chip-status-normal" },
  watch:    { label: "Watch",              tone: "chip-status-watch" },
  strained: { label: "Strained",           tone: "chip-status-strained" },
  critical: { label: "Critical",           tone: "chip-status-critical" },
  stale:    { label: "Awaiting fresh data",tone: "chip-status-stale" },
  unknown:  { label: "Unknown",            tone: "chip-status-unknown" },
};

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${Math.round(n).toLocaleString()}`;
}

function fmtAgo(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = Math.max(0, Date.now() - d.getTime());
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * Compact grid-status hero. Sits below the top nav, hugs the left edge so it
 * doesn't fight the right drawer. Click → opens full details in the
 * intelligence panel.
 */
export function StatusBar({ snapshot, onStatusClick }: Props) {
  const status = snapshot?.status ?? "unknown";
  const meta = STATUS_LABEL[status] ?? STATUS_LABEL.unknown;
  const loading = snapshot == null;

  return (
    <button
      type="button"
      onClick={onStatusClick}
      disabled={!snapshot || !onStatusClick}
      aria-label={`Puerto Rico grid status: ${meta.label}. ${snapshot ? "Open details" : ""}`}
      className={cn(
        "pointer-events-auto absolute left-3 z-20 flex flex-col gap-2 rounded-2xl glass px-4 py-3 text-left transition-shadow",
        "top-[5.5rem] sm:top-[5.25rem]",
        "w-[min(22rem,calc(100vw-1.5rem))]",
        snapshot && onStatusClick && "hover:shadow-[var(--shadow-card-lg)] cursor-pointer",
      )}
    >
      <div className="flex items-center gap-2">
        <Activity className={cn("size-4 shrink-0", status === "critical" && "text-crit pulse-critical")} aria-hidden />
        <span className="text-[10px] uppercase tracking-[0.18em] text-text-3">
          Puerto Rico grid
        </span>
        <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", meta.tone)}>
          {status}
        </span>
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-[17px] font-semibold leading-tight tracking-tight text-text">
          {loading ? "Loading…" : meta.label}
        </h1>
        {snapshot && onStatusClick ? (
          <ChevronRight className="size-4 shrink-0 text-text-3" aria-hidden />
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-3 border-t border-line pt-2.5">
        <Stat label="Demand" value={fmt(snapshot?.current_demand_mw)} unit="MW" />
        <Stat label="Gen" value={fmt(snapshot?.total_generation_mw)} unit="MW" />
        <Stat label="Reserve" value={fmt(snapshot?.operational_reserve_mw)} unit="MW" />
      </div>

      <div className="flex items-center justify-between gap-2 text-[10px] text-text-3">
        <span>Source: {snapshot?.source ?? "LUMA"}</span>
        <span>{fmtAgo(snapshot?.ts)}</span>
      </div>
    </button>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-[10px] uppercase tracking-wider text-text-3">{label}</span>
      <span className="text-base font-semibold text-text">
        {value}
        <span className="ml-0.5 text-[10px] font-normal text-text-3">{unit}</span>
      </span>
    </div>
  );
}
