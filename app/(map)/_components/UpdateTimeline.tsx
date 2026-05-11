"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatAge } from "@/lib/sources";

export interface UpdateItem {
  id: string;
  ts: string;
  source: "official" | "community" | "model";
  category?: string;
  text: string;
  url?: string;
}

const TONE = {
  official: "text-ok",
  community: "text-text-2",
  model: "text-warn",
} as const;

const DOT = {
  official: "bg-ok",
  community: "bg-text-2",
  model: "bg-warn",
} as const;

interface Props {
  items: UpdateItem[];
}

export function UpdateTimeline({ items }: Props) {
  const [open, setOpen] = useState(false);

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
          <span className="ml-2 text-text-3">{items.length}</span>
        </span>
        {open ? (
          <ChevronDown className="size-4 text-text-2" aria-hidden />
        ) : (
          <ChevronUp className="size-4 text-text-2" aria-hidden />
        )}
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
              {items.length === 0 ? (
                <li className="px-4 py-6 text-center text-xs text-text-3">
                  No updates yet. Ingestion runs every few minutes.
                </li>
              ) : (
                items.map((item) => (
                  <li key={item.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                    <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", DOT[item.source])} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 text-xs">
                        <span className={cn("font-mono uppercase tracking-wider", TONE[item.source])}>
                          {item.source}
                        </span>
                        {item.category ? (
                          <span className="text-text-3">· {item.category}</span>
                        ) : null}
                        <span className="ml-auto font-mono text-text-3">
                          {formatAge(item.ts)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-text">{item.text}</p>
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
