"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronUp, ChevronDown } from "lucide-react";
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
    <section
      aria-label="Update timeline"
      className={cn(
        "surface pointer-events-auto absolute inset-x-0 bottom-0 z-30 border-t border-line",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="update-timeline-body"
        className="flex w-full cursor-pointer items-center justify-between px-4 py-2 text-left text-xs transition-colors hover:bg-surface-2/50"
      >
        <span className="font-mono uppercase tracking-wider text-text-2">
          Live updates
          <span className="ml-2 text-text-3">{visible.length}</span>
          {unverifiedCount > 0 && !showUnverified ? (
            <span className="ml-2 rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-3">
              {unverifiedCount} hidden
            </span>
          ) : null}
        </span>
        <span className="flex items-center gap-3">
          {unverifiedCount > 0 ? (
            <span
              role="button"
              tabIndex={0}
              aria-pressed={showUnverified}
              onClick={(e) => {
                e.stopPropagation();
                setShowUnverified((v) => !v);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setShowUnverified((v) => !v);
                }
              }}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
                showUnverified
                  ? "border-line bg-surface-2 text-text-2"
                  : "border-line bg-surface text-text-3 hover:text-text-2",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  showUnverified ? "bg-stale" : "bg-line-2",
                )}
                aria-hidden
              />
              Unverified
            </span>
          ) : null}
          {open ? (
            <ChevronDown className="size-4 text-text-2" aria-hidden />
          ) : (
            <ChevronUp className="size-4 text-text-2" aria-hidden />
          )}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id="update-timeline-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-line"
          >
            <ul className="max-h-60 divide-y divide-line overflow-y-auto">
              {visible.length === 0 ? (
                <li className="px-4 py-6 text-center text-xs text-text-3">
                  No updates yet. Ingestion runs every few minutes.
                </li>
              ) : (
                visible.map((item) => (
                  <li
                    key={item.id}
                    className={cn(
                      "flex items-start gap-3 px-4 py-2.5 text-sm",
                      item.source === "unverified" &&
                        "border-l-2 border-dashed border-line-2 bg-surface/40",
                    )}
                  >
                    <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", DOT[item.source])} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 text-xs">
                        <span className={cn("font-mono uppercase tracking-wider", TONE[item.source])}>
                          {TIER_LABEL[item.source]}
                        </span>
                        {item.category ? (
                          <span className="text-text-3">· {item.category}</span>
                        ) : null}
                        <span className="ml-auto font-mono text-text-3">
                          {formatAge(item.ts)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-text">{item.text}</p>
                      {item.source === "unverified" ? (
                        <p className="mt-0.5 text-[10px] text-text-3">
                          Unverified social post — not confirmed by an operator.
                        </p>
                      ) : null}
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-0.5 inline-block text-xs text-text-2 underline-offset-2 hover:text-text hover:underline"
                        >
                          Source ↗
                        </a>
                      ) : null}
                    </div>
                  </li>
                ))
              )}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
