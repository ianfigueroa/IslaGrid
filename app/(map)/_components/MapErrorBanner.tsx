"use client";

import { AnimatePresence, motion } from "framer-motion";
import { TriangleAlert, X } from "lucide-react";

interface Props {
  message: string | null;
  onDismiss: () => void;
}

export function MapErrorBanner({ message, onDismiss }: Props) {
  return (
    <AnimatePresence>
      {message ? (
        <motion.aside
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="surface pointer-events-auto absolute bottom-12 left-1/2 z-30 w-[min(420px,calc(100%-2rem))] -translate-x-1/2 rounded-md p-3"
          role="alert"
        >
          <div className="flex items-start gap-3">
            <TriangleAlert
              className="mt-0.5 size-4 shrink-0 text-warn"
              aria-hidden
            />
            <div className="min-w-0 flex-1 text-sm text-text-2">
              <p>
                <span className="text-text">Map partially degraded.</span>{" "}
                {message}
              </p>
              <p className="mt-0.5 text-[11px] text-text-3">
                Other parts of the map keep working. Reload to retry.
              </p>
            </div>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss map error"
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
