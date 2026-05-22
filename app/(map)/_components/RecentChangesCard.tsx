"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, ChevronDown, ChevronUp, X } from "lucide-react";
import { cn } from "@/lib/cn";

interface RecentUpdate {
  id: string;
  ts: string;
  source: string;
  category: string | null;
  text: string;
  url: string | null;
}

interface Payload {
  updates: RecentUpdate[];
  fetched_at: string;
  reason?: string;
}

/**
 * Floating "Last hour" card pinned to the bottom-left of the map. Mirrors
 * the OutagesPanel polling pattern (30s) so it stays current without nagging
 * the API. Collapses into a low-profile pill so it can't fight the legend
 * for visual real estate.
 */
export function RecentChangesCard() {
  const [data, setData] = useState<Payload | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (dismissed) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/updates/recent", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as Payload;
        if (!cancelled) setData(json);
      } catch {
        /* leave previous data; the card just stops refreshing */
      }
    };
    void load();
    const t = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [dismissed]);

  const count = data?.updates.length ?? 0;
  const items = useMemo(() => data?.updates.slice(0, 6) ?? [], [data]);

  if (dismissed || count === 0) return null;

  return (
    // Stacked above the bottom-left MapLegend (which sits at bottom-20 on
    // mobile / bottom-4 on sm) and clear of the bottom-center LayerPills
    // toolbar. z-30 to sit above the legend (z-20) but below the layers
    // drawer (z-50). Expansion grows upward (bottom-anchored) and is
    // height-capped so it can't push off-screen on short viewports.
    <div className="pointer-events-auto absolute bottom-28 left-3 z-30 w-[min(18rem,calc(100vw-1.5rem))] sm:bottom-14">
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            key="expanded"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.18 }}
            className="origin-bottom overflow-hidden rounded-xl glass-strong"
          >
            <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
              <div className="flex items-center gap-2 leading-tight">
                <Activity className="size-3.5 text-brand" aria-hidden />
                <span className="text-[10px] uppercase tracking-[0.18em] text-text-3">
                  Last hour
                </span>
                <span className="text-[12px] font-semibold text-text tabular-nums">
                  {count}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  aria-label="Collapse"
                  className="grid size-7 place-items-center rounded-md text-text-2 hover:bg-surface-2 hover:text-text"
                >
                  <ChevronDown className="size-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => setDismissed(true)}
                  aria-label="Dismiss"
                  className="grid size-7 place-items-center rounded-md text-text-2 hover:bg-surface-2 hover:text-text"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </div>
            </header>
            <ul className="max-h-64 divide-y divide-line overflow-y-auto">
              {items.map((u) => (
                <li key={u.id} className="px-4 py-2.5 text-[12px] leading-tight">
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-1.5 py-px text-[9.5px] font-medium uppercase tracking-wider",
                        categoryTone(u.category),
                      )}
                    >
                      {labelFor(u.category)}
                    </span>
                    <span className="text-[10.5px] tabular-nums text-text-3">
                      {fmtAge(u.ts)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-text-2">{u.text}</p>
                </li>
              ))}
            </ul>
          </motion.div>
        ) : (
          <motion.button
            key="pill"
            type="button"
            onClick={() => setExpanded(true)}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.18 }}
            className="flex w-full items-center gap-2 rounded-full glass px-3 py-2 text-[12px] text-text-2 transition-colors hover:text-text"
          >
            <Activity className="size-3.5 text-brand" aria-hidden />
            <span className="font-medium text-text tabular-nums">{count}</span>
            <span>update{count === 1 ? "" : "s"} in the last hour</span>
            <ChevronUp className="ml-auto size-3.5 text-text-3" aria-hidden />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

function categoryTone(category: string | null): string {
  switch (category) {
    case "planned-work":
      return "border-warn/30 bg-warn-soft text-warn";
    case "outage":
      return "border-crit/30 bg-crit-soft text-crit";
    case "weather":
      return "border-brand/30 bg-brand-soft text-brand";
    case "announcement":
      return "border-line bg-surface-2 text-text-2";
    default:
      return "border-line bg-surface-2 text-text-3";
  }
}

function labelFor(category: string | null): string {
  if (!category) return "update";
  return category.replace(/-/g, " ");
}

function fmtAge(iso: string): string {
  const ageMin = (Date.now() - new Date(iso).getTime()) / 60000;
  if (ageMin < 1) return "just now";
  if (ageMin < 60) return `${Math.round(ageMin)}m ago`;
  return `${Math.round(ageMin / 60)}h ago`;
}
