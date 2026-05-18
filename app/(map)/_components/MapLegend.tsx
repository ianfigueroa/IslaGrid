"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Info, X } from "lucide-react";
import type { LayerKey } from "./LayerRail";

const SEEN_KEY = "islagrid:legend-seen";

interface Props {
  active: Set<LayerKey>;
}

interface Swatch {
  color: string;
  label: string;
}

const STATUS_SWATCHES: Swatch[] = [
  { color: "#10b981", label: "Normal" },
  { color: "#f59e0b", label: "Watch" },
  { color: "#fb923c", label: "Strained" },
  { color: "#ef4444", label: "Critical" },
  { color: "#94a3b8", label: "Stale / unknown" },
];

const RISK_SWATCHES: Swatch[] = [
  { color: "#65a30d", label: "Low" },
  { color: "#eab308", label: "Elevated" },
  { color: "#ea580c", label: "High" },
  { color: "#dc2626", label: "Severe" },
];

const FUEL_SWATCHES: Swatch[] = [
  { color: "#f5b942", label: "Solar" },
  { color: "#38bdf8", label: "Hydro" },
  { color: "#d97706", label: "Gas" },
  { color: "#c2865a", label: "Oil / diesel" },
  { color: "#6b7280", label: "Coal" },
  { color: "#94a3b8", label: "Wind" },
  { color: "#2dd4bf", label: "Battery" },
];

/**
 * Tiny "what do the colors mean?" chip + popover. Lives bottom-left of the
 * map so it doesn't fight the bottom layer toolbar.
 */
export function MapLegend({ active }: Props) {
  const [open, setOpen] = useState(false);

  // First visit: auto-open the legend so the colors aren't a mystery. After
  // any dismissal we remember the choice — repeat visitors don't need a
  // popover yelling at them every page load.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(SEEN_KEY) === "1") return;
      // Small delay so the map paints first; the popover then animates over it.
      const t = window.setTimeout(() => setOpen(true), 800);
      return () => window.clearTimeout(t);
    } catch {
      /* localStorage blocked (private mode) — leave the legend closed. */
    }
  }, []);

  const close = () => {
    setOpen(false);
    try {
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* same as above */
    }
  };

  const showRisk = active.has("outage-risk");
  const showPlants = active.has("generation");

  return (
    <div className="pointer-events-none absolute bottom-20 left-3 z-20 sm:bottom-4">
      <AnimatePresence>
        {open ? (
          <motion.div
            key="legend"
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-auto mb-2 w-64 rounded-xl border border-line bg-surface p-3 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[12px] font-semibold tracking-tight text-text">
                What the colors mean
              </h3>
              <button
                type="button"
                onClick={close}
                aria-label="Close legend"
                className="grid size-6 place-items-center rounded-full text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>

            <SwatchGroup
              title={showRisk ? "Outage risk" : "Grid status"}
              swatches={showRisk ? RISK_SWATCHES : STATUS_SWATCHES}
            />

            {showPlants ? (
              <SwatchGroup title="Power plants" swatches={FUEL_SWATCHES} dots />
            ) : null}

            <p className="mt-2 text-[10.5px] leading-snug text-text-3">
              Click a municipality for details, or a plant for fuel + capacity.
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <motion.button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        whileTap={{ scale: 0.92 }}
        whileHover={{ scale: 1.05 }}
        aria-label="Show map legend"
        aria-expanded={open}
        className="pointer-events-auto flex h-10 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[12px] font-medium text-text-2 shadow-md transition-colors hover:bg-surface-2 hover:text-text"
      >
        <Info className="size-3.5" aria-hidden />
        <span>Legend</span>
      </motion.button>
    </div>
  );
}

function SwatchGroup({
  title,
  swatches,
  dots = false,
}: {
  title: string;
  swatches: Swatch[];
  dots?: boolean;
}) {
  return (
    <div className="mt-3">
      <p className="mb-1.5 text-[9.5px] uppercase tracking-wider text-text-3">
        {title}
      </p>
      <ul className="space-y-1">
        {swatches.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-[11.5px] text-text-2">
            <span
              aria-hidden
              className={dots ? "size-2.5 rounded-full" : "h-3 w-5 rounded-sm"}
              style={{ backgroundColor: s.color }}
            />
            <span>{s.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
