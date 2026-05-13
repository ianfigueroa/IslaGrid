"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

export interface PanelSelection {
  kind: "municipality" | "plant" | "report-cluster";
  id: string;
  title: string;
  subtitle?: string;
  body?: React.ReactNode;
}

interface Props {
  selection: PanelSelection | null;
  onClose: () => void;
}

const transition = { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const };

export function IntelligencePanel({ selection, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!selection) return;
    // preventScroll stops the browser from scrolling the whole page to bring
    // the close button into view while the panel is still mid-slide from the
    // right (which yanked the brand pill + status pill off-screen on click).
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, onClose]);

  return (
    <AnimatePresence>
      {selection ? (
        <motion.aside
          key={selection.id}
          role="dialog"
          aria-modal="false"
          aria-label={`Details: ${selection.title}`}
          initial={{ x: "100%", opacity: 0.4 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "100%", opacity: 0.4 }}
          transition={transition}
          className={cn(
            // Fully opaque card so the muni details are readable over any
            // basemap. Earlier we used translucent glass which made text fade
            // into the map underneath.
            "pointer-events-auto absolute right-3 top-[4.5rem] bottom-14 z-20",
            "w-[min(380px,calc(100%-1.5rem))] rounded-2xl",
            "flex flex-col overflow-hidden",
            "bg-surface border border-line shadow-2xl",
          )}
        >
          <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0">
              <p className="truncate font-mono text-[11px] uppercase tracking-wider text-text-3">
                {selection.kind.replace("-", " ")}
              </p>
              <h2 className="truncate text-base font-medium text-text">{selection.title}</h2>
              {selection.subtitle ? (
                <p className="truncate text-xs text-text-2">{selection.subtitle}</p>
              ) : null}
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close details panel"
              className="cursor-pointer rounded-md p-1 text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
            >
              <X className="size-5" aria-hidden />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-4 text-sm text-text-2">
            {selection.body ?? (
              <p className="text-text-3">
                No details yet for this selection. Data layers ship in upcoming phases.
              </p>
            )}
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
