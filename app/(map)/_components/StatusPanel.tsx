"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatAge } from "@/lib/sources";
import type { GridSnapshot } from "@/lib/supabase";
import type { UpdateItem, UpdateTier } from "./UpdateTimeline";

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

const STATUS_META: Record<string, { label: string; sub: string; tone: string }> = {
  normal:   { label: "Operating normally",  sub: "Reserves healthy, demand stable.",                 tone: "text-ok" },
  watch:    { label: "Watch",               sub: "Demand rising or reserves thinning.",              tone: "text-warn" },
  strained: { label: "Strained",            sub: "Reserves below comfortable target.",               tone: "text-warn" },
  critical: { label: "Critical",            sub: "Major outage, generation loss, or storm threat.",  tone: "text-crit" },
  stale:    { label: "Awaiting fresh data", sub: "Upstream source reports maintenance values.",      tone: "text-text-3" },
  unknown:  { label: "Status unknown",      sub: "No snapshot received yet.",                        tone: "text-text-3" },
};

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return Math.round(n).toLocaleString();
}

interface Props {
  open: boolean;
  onClose: () => void;
  snapshot: GridSnapshot | null;
  updates: UpdateItem[];
}

/**
 * Right-side civic dashboard panel. Opens when the user clicks the floating
 * status pill. Combines the grid telemetry, status reasons, and live update
 * feed into one focused surface. Map stays interactive underneath.
 */
export function StatusPanel({ open, onClose, snapshot, updates }: Props) {
  const [showUnverified, setShowUnverified] = useState(true);

  const status = snapshot?.status ?? "unknown";
  const meta = STATUS_META[status] ?? STATUS_META.unknown;

  const filtered = useMemo(
    () => (showUnverified ? updates : updates.filter((u) => u.source !== "unverified")),
    [updates, showUnverified],
  );

  const unverifiedCount = useMemo(
    () => updates.filter((u) => u.source === "unverified").length,
    [updates],
  );

  return (
    <AnimatePresence>
      {open ? (
        <motion.aside
          key="status-panel"
          role="dialog"
          aria-modal="false"
          aria-label="Grid status details"
          initial={{ x: "calc(100% + 1rem)", opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "calc(100% + 1rem)", opacity: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 36, mass: 0.9 }}
          className="pointer-events-auto absolute right-4 top-4 bottom-4 z-30 flex w-[min(24rem,calc(100vw-2rem))] flex-col rounded-2xl glass-strong overflow-hidden"
        >
          {/* Header */}
          <header className="flex items-start gap-3 border-b border-line px-5 py-4">
            <div className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="text-[10px] uppercase tracking-[0.18em] text-text-3">
                Puerto Rico grid
              </span>
              <span className={cn("text-[18px] font-semibold tracking-tight", meta.tone)}>
                {meta.label}
              </span>
              <span className="mt-1 text-[12px] text-text-2">{meta.sub}</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close grid status"
              className="grid size-9 shrink-0 place-items-center rounded-full text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
            >
              <X className="size-4" aria-hidden />
            </button>
          </header>

          {/* Telemetry */}
          <section className="grid grid-cols-3 gap-2 border-b border-line px-5 py-4">
            <Metric label="Demand"   value={fmt(snapshot?.current_demand_mw)}     unit="MW" />
            <Metric label="Gen"      value={fmt(snapshot?.total_generation_mw)}   unit="MW" />
            <Metric label="Reserve"  value={fmt(snapshot?.operational_reserve_mw)} unit="MW" />
            <Metric label="Capacity" value={fmt(snapshot?.available_capacity_mw)} unit="MW" sub />
            <Metric label="Next hour" value={fmt(snapshot?.next_hour_demand_mw)}   unit="MW" sub />
            <Metric label="Peak fcst" value={fmt(snapshot?.peak_demand_forecast_mw)} unit="MW" sub />
          </section>

          {/* Reasons */}
          {snapshot?.status_reasons && snapshot.status_reasons.length > 0 ? (
            <section className="border-b border-line px-5 py-3.5">
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-3">
                Why this status
              </h3>
              <ul className="space-y-1.5 text-[12.5px] text-text">
                {snapshot.status_reasons.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 leading-snug">
                    <span className="mt-1 size-1 shrink-0 rounded-full bg-text-3" aria-hidden />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Updates feed */}
          <section className="flex min-h-0 flex-1 flex-col">
            <header className="flex items-center justify-between border-b border-line px-5 py-3">
              <h3 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-text-2">
                Live updates
                <span className="ml-2 font-normal text-text-3">{filtered.length}</span>
              </h3>
              {unverifiedCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowUnverified((v) => !v)}
                  aria-pressed={showUnverified}
                  className={cn(
                    "pill h-7 text-[11px]",
                    showUnverified && "pill-active",
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      showUnverified ? "bg-brand" : "bg-line-2",
                    )}
                    aria-hidden
                  />
                  Unverified · {unverifiedCount}
                </button>
              ) : null}
            </header>

            <motion.ul
              initial="hidden"
              animate="visible"
              variants={{
                visible: { transition: { staggerChildren: 0.025, delayChildren: 0.08 } },
              }}
              className="flex-1 divide-y divide-line overflow-y-auto"
            >
              {filtered.length === 0 ? (
                <li className="px-5 py-12 text-center text-[13px] text-text-3">
                  No updates yet. Ingestion runs every few minutes.
                </li>
              ) : (
                filtered.slice(0, 60).map((item) => (
                  <motion.li
                    key={item.id}
                    variants={{
                      hidden: { opacity: 0, y: 6 },
                      visible: { opacity: 1, y: 0 },
                    }}
                    className={cn(
                      "flex items-start gap-3 px-5 py-3 text-[13px] transition-colors hover:bg-surface-2",
                      item.source === "unverified" && "bg-surface/40",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        DOT[item.source],
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 text-[10.5px]">
                        <span
                          className={cn(
                            "font-semibold uppercase tracking-wider",
                            TONE[item.source],
                          )}
                        >
                          {TIER_LABEL[item.source]}
                        </span>
                        {item.category ? (
                          <span className="text-text-3">· {item.category}</span>
                        ) : null}
                        <span className="ml-auto text-text-3">
                          {formatAge(item.ts)}
                        </span>
                      </div>
                      <p className="mt-1 leading-snug text-text">{item.text}</p>
                      {item.source === "unverified" ? (
                        <p className="mt-1 text-[10.5px] text-text-3">
                          Unverified social post — not confirmed by an operator.
                        </p>
                      ) : null}
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-brand transition-opacity hover:opacity-80"
                        >
                          Open source
                          <ChevronRight className="size-3" aria-hidden />
                        </a>
                      ) : null}
                    </div>
                  </motion.li>
                ))
              )}
            </motion.ul>
          </section>

          <footer className="flex items-center justify-between gap-2 border-t border-line px-5 py-2.5 text-[10.5px] text-text-3">
            <span>Source: {snapshot?.source ?? "LUMA"}</span>
            <span>{snapshot?.ts ? formatAge(snapshot.ts) : "—"}</span>
          </footer>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}

function Metric({
  label,
  value,
  unit,
  sub = false,
}: {
  label: string;
  value: string;
  unit: string;
  sub?: boolean;
}) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-[9.5px] uppercase tracking-wider text-text-3">{label}</span>
      <span
        className={cn(
          "font-semibold tabular-nums",
          sub ? "text-[14px] text-text-2" : "text-[18px] text-text",
        )}
      >
        {value}
        <span className="ml-0.5 text-[9.5px] font-normal text-text-3">{unit}</span>
      </span>
    </div>
  );
}
