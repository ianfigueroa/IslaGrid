"use client";

import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { useOutagesSummary } from "./OutagesPanel";

/**
 * Slim banner pinned to the top of the map view ("X customers without power
 * right now"). Styled by severity tier so the eye can register the state at
 * a glance without reading the number — gray <500, amber <10k, red ≥10k.
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
    </div>
  );
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
