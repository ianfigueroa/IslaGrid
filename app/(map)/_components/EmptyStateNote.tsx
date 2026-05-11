"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Info, X } from "lucide-react";

interface Props {
  visible: boolean;
}

/**
 * Small floating note shown when there's no `grid_snapshot` row yet.
 * Honest about *why* there's no data, not a generic "loading…" lie.
 */
export function EmptyStateNote({ visible }: Props) {
  const [dismissed, setDismissed] = useState(false);
  const show = visible && !dismissed;

  return (
    <AnimatePresence>
      {show ? (
        <motion.aside
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="surface pointer-events-auto absolute left-1/2 top-20 z-20 w-[min(560px,calc(100%-32px))] -translate-x-1/2 rounded-md p-4"
          role="status"
        >
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            <div className="min-w-0 flex-1 text-sm text-text-2">
              <p>
                <span className="text-text">No live grid snapshot yet.</span>{" "}
                As of 2026-05-11 the PR government data backend is in maintenance and
                LUMA's page is showing blank MW values. Ingestion still runs every
                few minutes and saves raw snapshots — numbers will populate as
                soon as a source returns data.
              </p>
              <p className="mt-1 text-xs text-text-3">
                Every number here will carry a source label and "as of"
                timestamp.{" "}
                <a
                  href="/attribution"
                  className="text-text-2 underline-offset-2 hover:text-text hover:underline"
                >
                  See sources →
                </a>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              aria-label="Dismiss empty-state note"
              className="cursor-pointer rounded-md p-1 text-text-3 transition-colors hover:bg-surface-2 hover:text-text"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
