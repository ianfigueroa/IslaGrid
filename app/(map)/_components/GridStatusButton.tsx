"use client";

import { motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import type { GridSnapshot } from "@/lib/supabase";

const STATUS_LABEL: Record<string, { label: string; tone: string; dot: string }> = {
  normal:   { label: "Normal",   tone: "text-ok",    dot: "bg-ok" },
  watch:    { label: "Watch",    tone: "text-warn",  dot: "bg-warn" },
  strained: { label: "Strained", tone: "text-warn",  dot: "bg-warn" },
  critical: { label: "Critical", tone: "text-crit",  dot: "bg-crit" },
  stale:    { label: "Stale",    tone: "text-text-3", dot: "bg-stale" },
  unknown:  { label: "Unknown",  tone: "text-text-3", dot: "bg-stale" },
};

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return Math.round(n).toLocaleString();
}

interface Props {
  snapshot: GridSnapshot | null;
  onClick: () => void;
  active: boolean;
}

/**
 * Tiny floating pill — top-left, below the brand chip. Always visible,
 * never dominant. Click → opens the StatusPanel from the right side.
 */
export function GridStatusButton({ snapshot, onClick, active }: Props) {
  const status = snapshot?.status ?? "unknown";
  const meta = STATUS_LABEL[status] ?? STATUS_LABEL.unknown;
  const isCritical = status === "critical";

  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      aria-label={`Grid status: ${meta.label}. Click to open details.`}
      aria-pressed={active}
      className={cn(
        "pointer-events-auto absolute left-4 top-[6.5rem] z-30 flex h-11 items-center gap-3 rounded-full pl-2.5 pr-4 text-text transition-shadow",
        active
          ? "glass-strong shadow-[var(--shadow-card-lg)]"
          : "glass hover:shadow-[var(--shadow-card-lg)]",
      )}
    >
      <span
        className={cn(
          "relative grid size-7 place-items-center rounded-full bg-surface-2",
          isCritical && "pulse-critical",
        )}
        aria-hidden
      >
        <span className={cn("size-2.5 rounded-full", meta.dot)} />
      </span>
      <div className="flex flex-col items-start leading-tight">
        <span className="text-[9px] uppercase tracking-[0.18em] text-text-3">
          PR grid
        </span>
        <span className={cn("text-[13px] font-semibold", meta.tone)}>
          {meta.label}
          {snapshot?.current_demand_mw != null ? (
            <span className="ml-1.5 font-normal text-text-2">
              · {fmt(snapshot.current_demand_mw)} MW
            </span>
          ) : null}
        </span>
      </div>
      <ChevronRight
        className={cn(
          "size-3.5 shrink-0 text-text-3 transition-transform duration-200",
          active && "rotate-90",
        )}
        aria-hidden
      />
    </motion.button>
  );
}
