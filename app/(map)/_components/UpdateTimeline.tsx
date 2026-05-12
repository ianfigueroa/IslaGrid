"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, MessagesSquare, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatAge } from "@/lib/sources";

export type UpdateTier = "official" | "planned" | "announcement" | "community" | "model" | "unverified";

export interface UpdateItem {
  id: string;
  ts: string;
  source: UpdateTier;
  category?: string;
  text: string;
  url?: string;
}

const TONE: Record<UpdateTier, string> = {
  official:     "text-ok",
  planned:      "text-warn",
  announcement: "text-text-2",
  community:    "text-text-2",
  model:        "text-warn",
  unverified:   "text-text-3",
};

const DOT: Record<UpdateTier, string> = {
  official:     "bg-ok",
  planned:      "bg-warn",
  announcement: "bg-text-2",
  community:    "bg-text-2",
  model:        "bg-warn",
  unverified:   "bg-stale",
};

const TIER_LABEL: Record<UpdateTier, string> = {
  official:     "Official",
  planned:      "Planned",
  announcement: "Aviso",
  community:    "Community",
  model:        "Model",
  unverified:   "Unverified",
};

interface Props {
  items: UpdateItem[];
}

/**
 * Right-side drawer. Collapsed by default (just a tab handle on the edge),
 * expands to a 360px column when clicked. The map underneath remains fully
 * interactive whether the drawer is open or closed.
 */
export function UpdateTimeline({ items }: Props) {
  const [open, setOpen] = useState(false);
  const [showUnverified, setShowUnverified] = useState(true);

  const visible = useMemo(
    () => (showUnverified ? items : items.filter((i) => i.source !== "unverified")),
    [items, showUnverified],
  );
  const unverifiedCount = useMemo(
    () => items.filter((i) => i.source === "unverified").length,
    [items],
  );

  return (
    <>
      {/* Collapsed tab — visible when drawer is closed */}
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Open live updates (${items.length} items)`}
          className="pointer-events-auto absolute right-3 top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-1.5 rounded-l-2xl glass-strong px-2.5 py-4 text-text-2 transition-colors hover:text-text"
        >
          <MessagesSquare className="size-4" aria-hidden />
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] [writing-mode:vertical-rl]">
            Updates
          </span>
          {items.length > 0 ? (
            <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold text-white">
              {items.length > 99 ? "99+" : items.length}
            </span>
          ) : null}
        </button>
      ) : null}

      {/* Drawer */}
      <AnimatePresence>
        {open ? (
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            aria-label="Live updates"
            className="pointer-events-auto absolute right-3 top-3 bottom-3 z-30 flex w-[min(22rem,calc(100vw-1.5rem))] flex-col rounded-2xl glass-strong"
          >
            {/* Header */}
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <MessagesSquare className="size-4 text-brand" aria-hidden />
              <div className="flex min-w-0 flex-col leading-tight">
                <span className="text-sm font-semibold text-text">Live updates</span>
                <span className="text-[10px] text-text-3">
                  {visible.length} · across LUMA, NWS, community
                </span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ml-auto grid size-8 place-items-center rounded-lg text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
                aria-label="Close updates"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>

            {/* Filter toggles */}
            {unverifiedCount > 0 ? (
              <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                <button
                  type="button"
                  onClick={() => setShowUnverified((v) => !v)}
                  aria-pressed={showUnverified}
                  className={cn("pill", showUnverified && "pill-active")}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      showUnverified ? "bg-brand" : "bg-line-2",
                    )}
                    aria-hidden
                  />
                  Unverified ({unverifiedCount})
                </button>
              </div>
            ) : null}

            {/* Feed */}
            <ul className="flex-1 divide-y divide-line overflow-y-auto">
              {visible.length === 0 ? (
                <li className="px-4 py-12 text-center text-sm text-text-3">
                  No updates yet. Ingestion runs every few minutes.
                </li>
              ) : (
                visible.map((item) => (
                  <li
                    key={item.id}
                    className={cn(
                      "flex items-start gap-3 px-4 py-3 text-sm transition-colors hover:bg-surface-2",
                      item.source === "unverified" && "bg-surface/40",
                    )}
                  >
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[item.source])} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 text-[11px]">
                        <span className={cn("font-semibold uppercase tracking-wider", TONE[item.source])}>
                          {TIER_LABEL[item.source]}
                        </span>
                        {item.category ? (
                          <span className="text-text-3">· {item.category}</span>
                        ) : null}
                        <span className="ml-auto text-text-3">{formatAge(item.ts)}</span>
                      </div>
                      <p className="mt-1 text-[13px] leading-snug text-text">{item.text}</p>
                      {item.source === "unverified" ? (
                        <p className="mt-1 text-[11px] text-text-3">
                          Unverified social post — not confirmed by an operator.
                        </p>
                      ) : null}
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-[12px] text-brand transition-opacity hover:opacity-80"
                        >
                          Open source
                          <ChevronRight className="size-3" aria-hidden />
                        </a>
                      ) : null}
                    </div>
                  </li>
                ))
              )}
            </ul>
          </motion.aside>
        ) : null}
      </AnimatePresence>
    </>
  );
}
