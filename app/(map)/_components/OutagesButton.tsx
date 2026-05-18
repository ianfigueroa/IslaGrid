"use client";

import { motion } from "framer-motion";
import { ChevronRight, Flame } from "lucide-react";
import { cn } from "@/lib/cn";
import { useOutagesSummary } from "./OutagesPanel";

interface Props {
  active: boolean;
  onClick: () => void;
}

/**
 * Floating pill below the GridStatusButton. Click → opens OutagesPanel.
 * Shows the live customers-out count so the user knows whether to dig in.
 */
export function OutagesButton({ active, onClick }: Props) {
  const { data } = useOutagesSummary();
  const total = data?.total_customers ?? 0;
  const tone = total >= 10_000 ? "text-crit" : total >= 500 ? "text-warn" : "text-text-2";

  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      aria-label={`Active outages: ${total.toLocaleString()} customers. Click to open list.`}
      aria-pressed={active}
      className={cn(
        "pointer-events-auto absolute left-4 top-[8rem] z-30 flex h-11 items-center gap-3 rounded-full pl-2.5 pr-4 text-text transition-shadow",
        active
          ? "glass-strong shadow-[var(--shadow-card-lg)]"
          : "glass hover:shadow-[var(--shadow-card-lg)]",
      )}
    >
      <span
        className="relative grid size-7 place-items-center rounded-full bg-surface-2"
        aria-hidden
      >
        <Flame className={cn("size-3.5", tone)} />
      </span>
      <div className="flex flex-col items-start leading-tight">
        <span className="text-[9px] uppercase tracking-[0.18em] text-text-3">
          Outages
        </span>
        <span className={cn("text-[13px] font-semibold tabular-nums", tone)}>
          {total.toLocaleString()}
          <span className="ml-1.5 font-normal text-text-2">customers</span>
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
