"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CloudRain,
  Factory,
  Flame,
  Globe2,
  Layers,
  MessageSquareWarning,
  Sliders,
  TriangleAlert,
  Waves,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { LayerKey } from "./LayerRail";

// Primary pills — the ones visible by default at the bottom. Ordered by
// "what does a worried user want to see first during a storm?".
interface PillDef {
  key: LayerKey;
  label: string;
  Icon: LucideIcon;
}

const PRIMARY: PillDef[] = [
  { key: "outage-risk",    label: "Risk",     Icon: TriangleAlert },
  { key: "outages-live",   label: "Outages",  Icon: Flame },
  { key: "weather-alerts", label: "Alerts",   Icon: CloudRain },
  { key: "generation",     label: "Plants",   Icon: Zap },
  { key: "hurricane",      label: "Hurricane", Icon: Globe2 },
];

// Everything else lives in the More drawer (legend below). The old
// "Grid status fill" pill was removed — its key (`grid-now`) was declared
// in the layer union but never wired to a real map source, so toggling it
// did nothing. The risk-band layer covers the same intent.
const MORE: PillDef[] = [
  { key: "municipalities", label: "Municipality borders", Icon: Layers },
  { key: "infrastructure", label: "Lines & substations",  Icon: Factory },
  { key: "planned-work",   label: "Planned work",         Icon: Wrench },
  { key: "quakes",         label: "Earthquakes",          Icon: Waves },
  { key: "reports",        label: "Community reports",    Icon: MessageSquareWarning },
];

type PresetKey = "default" | "storm" | "solar" | "reporter";

const PRESETS: Record<PresetKey, { label: string; layers: LayerKey[] }> = {
  default:  { label: "Default",  layers: ["municipalities", "outage-risk", "generation"] },
  storm:    { label: "Storm",    layers: ["municipalities", "weather-alerts", "hurricane", "outage-risk", "outages-live"] },
  solar:    { label: "Solar",    layers: ["municipalities", "generation"] },
  reporter: { label: "Reporter", layers: ["municipalities", "reports", "weather-alerts", "outages-live"] },
};

interface Props {
  active: Set<LayerKey>;
  onSetActive: (next: Set<LayerKey>) => void;
}

/**
 * Floating bottom toolbar — the Windy-style chrome surface. Tap a pill to
 * toggle a primary layer; tap "More" to slide up the full layer drawer for
 * the less-used filters and presets.
 */
export function LayerPills({ active, onSetActive }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);

  const toggle = (key: LayerKey) => {
    const next = new Set(active);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSetActive(next);
  };

  const applyPreset = (k: PresetKey) => {
    onSetActive(new Set(PRESETS[k].layers));
  };

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-3">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="pointer-events-auto flex max-w-full items-center gap-1.5 overflow-x-auto rounded-2xl glass-strong px-2 py-2 sm:gap-2"
          aria-label="Map layer toolbar"
        >
          {PRIMARY.map(({ key, label, Icon }) => {
            const isActive = active.has(key);
            return (
              <motion.button
                key={key}
                type="button"
                onClick={() => toggle(key)}
                aria-pressed={isActive}
                aria-label={`${label} layer${isActive ? " (active)" : ""}`}
                // Pop on click — scale up briefly then return. No sliding ring
                // between pills (the layoutId variant was confusing).
                whileTap={{ scale: 0.9 }}
                animate={isActive ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                transition={{ duration: 0.28, ease: [0.34, 1.56, 0.64, 1] }}
                className={cn(
                  // 44×44 minimum for accessibility
                  "group relative flex h-11 shrink-0 items-center gap-2 rounded-xl px-3 transition-colors",
                  isActive
                    ? "bg-brand text-white shadow-[0_4px_16px_-4px_var(--color-brand)]"
                    : "text-text-2 hover:bg-surface-2 hover:text-text",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="text-[13px] font-medium">{label}</span>
              </motion.button>
            );
          })}

          <div className="mx-1 h-7 w-px bg-line" />

          <motion.button
            type="button"
            onClick={() => setMoreOpen(true)}
            whileTap={{ scale: 0.93 }}
            aria-label="More layers + presets"
            className="flex h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
          >
            <Sliders className="size-4" aria-hidden />
            <span className="text-[13px] font-medium">More</span>
          </motion.button>
        </motion.div>
      </div>

      <AnimatePresence>
        {moreOpen ? (
          <>
            <motion.div
              key="scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="pointer-events-auto fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
              onClick={() => setMoreOpen(false)}
              aria-hidden
            />
            <motion.div
              key="drawer"
              role="dialog"
              aria-modal="true"
              aria-label="All map layers"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 36, mass: 0.9 }}
              className="pointer-events-auto fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-3xl glass-strong"
            >
              <div className="mx-auto mt-2 h-1 w-12 rounded-full bg-line-2" aria-hidden />
              <div className="flex items-baseline gap-3 px-5 pb-2 pt-3">
                <h2 className="text-base font-semibold tracking-tight">Map layers</h2>
                <span className="text-[11px] text-text-3">Tap to toggle. Presets stage common layer sets.</span>
                <button
                  type="button"
                  onClick={() => setMoreOpen(false)}
                  className="ml-auto rounded-full px-2 py-1 text-[12px] text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
                >
                  Done
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 px-4 pb-2 sm:grid-cols-4">
                {(Object.keys(PRESETS) as PresetKey[]).map((k) => (
                  <motion.button
                    key={k}
                    type="button"
                    onClick={() => {
                      applyPreset(k);
                    }}
                    whileTap={{ scale: 0.96 }}
                    className="flex h-12 items-center justify-center gap-2 rounded-xl border border-line bg-surface text-[13px] font-medium text-text-2 transition-colors hover:border-brand hover:bg-brand-soft hover:text-brand"
                  >
                    {PRESETS[k].label}
                  </motion.button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-1.5 p-4 sm:grid-cols-3 md:grid-cols-4">
                {[...PRIMARY, ...MORE].map(({ key, label, Icon }) => {
                  const isActive = active.has(key);
                  return (
                    <motion.button
                      key={key}
                      type="button"
                      onClick={() => toggle(key)}
                      aria-pressed={isActive}
                      whileTap={{ scale: 0.96 }}
                      className={cn(
                        "flex h-12 items-center gap-2.5 rounded-xl px-3 transition-colors",
                        isActive
                          ? "bg-brand text-white"
                          : "bg-surface text-text-2 hover:bg-surface-2 hover:text-text",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      <span className="truncate text-[13px] font-medium">{label}</span>
                    </motion.button>
                  );
                })}
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
}
