"use client";

import { ArrowDown, ArrowUp, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { useOutagesSummary } from "./OutagesPanel";

/**
 * Slim banner pinned to the top of the map view ("X customers without power
 * right now"). Styled by severity tier so the eye can register the state at
 * a glance without reading the number — gray <500, amber <10k, red ≥10k.
 *
 * The trend chip on the right compares to a snapshot from ~1h ago so users
 * can see whether the situation is getting better or worse without having to
 * remember what the number was last time they looked. We only render the
 * chip when the absolute delta is ≥10 customers and ≥1% of current — small
 * jitter from ingest noise shouldn't ping the eye.
 *
 * Shares a fetch with OutagesPanel via useOutagesSummary so we don't double-
 * poll /api/outages/summary while both are mounted.
 */
export function OutageBanner() {
  const { data } = useOutagesSummary();
  // Don't flash placeholder text on first load — render nothing until the
  // first response arrives. The status pill below carries the load.
  if (!data) return null;
  const total = data.total_customers;
  const tone = toneFor(total);
  const delta = computeDelta(total, data.total_customers_1h_ago);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-auto absolute inset-x-0 top-0 z-20 flex h-9 items-center justify-center gap-2 px-3 text-[12.5px] backdrop-blur-md",
        tone.bg,
        tone.text,
      )}
    >
      {total >= 500 ? (
        <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
      ) : (
        <span
          className={cn("size-2 shrink-0 rounded-full", tone.dot)}
          aria-hidden
        />
      )}
      <span className="font-medium tabular-nums">
        {total.toLocaleString()}
      </span>
      <span>customers without power right now</span>
      {delta ? (
        <span
          className={cn(
            "inline-flex items-center gap-0.5 rounded-full border px-1.5 py-px text-[10.5px] font-medium tabular-nums",
            delta.direction === "up"
              ? "border-crit/40 bg-crit/15 text-crit"
              : "border-ok/40 bg-ok/15 text-ok",
          )}
          title={`Up ~1 hour ago: ${delta.previous.toLocaleString()}`}
        >
          {delta.direction === "up" ? (
            <ArrowUp className="size-3" aria-hidden />
          ) : (
            <ArrowDown className="size-3" aria-hidden />
          )}
          {delta.absolute.toLocaleString()} in 1h
        </span>
      ) : null}
    </div>
  );
}

function computeDelta(
  current: number,
  previous: number | null,
): { absolute: number; direction: "up" | "down"; previous: number } | null {
  if (previous === null || previous === undefined) return null;
  const diff = current - previous;
  const abs = Math.abs(diff);
  // Floor to suppress jitter: ignore deltas <10 customers AND <1% of current.
  if (abs < 10) return null;
  if (current > 0 && abs / Math.max(current, previous) < 0.01) return null;
  return {
    absolute: abs,
    direction: diff >= 0 ? "up" : "down",
    previous,
  };
}

function toneFor(total: number): {
  bg: string;
  text: string;
  dot: string;
} {
  if (total >= 10_000) {
    return {
      bg: "bg-crit/12 border-b border-crit/30",
      text: "text-crit",
      dot: "bg-crit",
    };
  }
  if (total >= 500) {
    return {
      bg: "bg-warn/10 border-b border-warn/30",
      text: "text-warn",
      dot: "bg-warn",
    };
  }
  return {
    bg: "bg-surface/40 border-b border-line",
    text: "text-text-2",
    dot: "bg-ok",
  };
}
