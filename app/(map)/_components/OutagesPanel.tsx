"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { X, ChevronDown, ChevronRight, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import type { OutageSummary, RegionGroup } from "@/lib/outages-summary-types";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Right-side panel listing active outages grouped by LUMA region. Mirrors
 * lumatrackpr.com's "Active outages" sidebar but skinned to match the rest
 * of the IslaGrid chrome. Polls /api/outages/summary on a 60s cadence
 * while open (silent when closed to save battery).
 */
export function OutagesPanel({ open, onClose }: Props) {
  const [data, setData] = useState<OutageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/outages/summary", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as OutageSummary;
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load outages");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const t = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [open]);

  const total = data?.total_customers ?? 0;
  const dotTone = severityDot(total);

  return (
    <AnimatePresence>
      {open ? (
        <motion.aside
          key="outages-panel"
          role="dialog"
          aria-modal="false"
          aria-label="Active outages by region"
          initial={{ x: "calc(100% + 1rem)", opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "calc(100% + 1rem)", opacity: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 36, mass: 0.9 }}
          className="pointer-events-auto absolute right-4 top-4 bottom-4 z-30 flex w-[min(24rem,calc(100vw-2rem))] flex-col rounded-2xl glass-strong overflow-hidden"
        >
          <header className="flex items-start gap-3 border-b border-line px-5 py-4">
            <div className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="text-[10px] uppercase tracking-[0.18em] text-text-3">
                Active outages
              </span>
              <div className="mt-1 flex items-center gap-2">
                <span className={cn("size-2.5 rounded-full", dotTone)} aria-hidden />
                <span className="text-[20px] font-semibold tracking-tight text-text tabular-nums">
                  {total.toLocaleString()}
                </span>
                <span className="text-[12px] text-text-2">customers</span>
              </div>
              <span className="mt-1 text-[11px] text-text-3">
                Source: LUMA regions feed · refreshes every 30s
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close active outages"
              className="grid size-9 shrink-0 place-items-center rounded-full text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
            >
              <X className="size-4" aria-hidden />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {error ? (
              <div className="px-5 py-8 text-[13px] text-text-3">{error}</div>
            ) : !data ? (
              <div className="px-5 py-8 text-[13px] text-text-3">
                {loading ? "Loading active outages…" : "—"}
              </div>
            ) : data.groups.length === 0 ? (
              <div className="px-5 py-8 text-center text-[13px] text-text-3">
                No active outages reported island-wide.
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {data.groups.map((g) => (
                  <RegionRow key={g.region} group={g} />
                ))}
              </ul>
            )}
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}

function RegionRow({ group }: { group: RegionGroup }) {
  const [open, setOpen] = useState(false);
  const top = group.municipalities.slice(0, 5);
  const more = group.municipalities.length - top.length;
  // When AEEPR feeders are empty there's no muni breakdown to drill into; the
  // chevron would open an empty list and the "0 feeders" caption was lying
  // about the underlying source. Collapse to a static row in that case.
  const expandable = group.municipalities.length > 0;

  const RowInner = (
    <>
      <span
        className={cn(
          "mt-0.5 size-2 shrink-0 rounded-full",
          severityDot(group.total_customers),
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[14px] font-semibold text-text">
            {group.region}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[12px] text-text-2 tabular-nums">
            <Users className="size-3" aria-hidden />
            {group.total_customers.toLocaleString()}
          </span>
        </div>
        <span className="text-[11px] text-text-3">
          {expandable
            ? `${group.total_feeders} feeder${group.total_feeders === 1 ? "" : "s"}`
            : "Region-level estimate · per-feeder data unavailable"}
        </span>
      </div>
      {expandable ? (
        open ? (
          <ChevronDown className="size-4 shrink-0 text-text-3" aria-hidden />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-text-3" aria-hidden />
        )
      ) : null}
    </>
  );

  return (
    <li>
      {expandable ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-surface-2"
        >
          {RowInner}
        </button>
      ) : (
        <div className="flex items-center gap-3 px-5 py-3">{RowInner}</div>
      )}
      {expandable && open ? (
        <ul className="border-t border-line bg-surface/50 pb-2">
          {(more > 0 ? group.municipalities : top).map((m) => (
            <li key={`${group.region}-${m.name}`}>
              {m.id ? (
                <Link
                  href={`/m/${m.id}`}
                  className="flex items-center justify-between gap-3 px-7 py-1.5 text-[12.5px] text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
                >
                  <span className="truncate">{m.name}</span>
                  <span className="shrink-0 tabular-nums text-text-3">
                    ~{m.customers.toLocaleString()}
                  </span>
                </Link>
              ) : (
                <div className="flex items-center justify-between gap-3 px-7 py-1.5 text-[12.5px] text-text-2">
                  <span className="truncate">{m.name}</span>
                  <span className="shrink-0 tabular-nums text-text-3">
                    ~{m.customers.toLocaleString()}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : expandable && top.length > 0 ? (
        <ul className="border-t border-line bg-surface/30 pb-2">
          {top.map((m) => (
            <li
              key={`${group.region}-preview-${m.name}`}
              className="flex items-center justify-between gap-3 px-7 py-1 text-[12px] text-text-3"
            >
              <span className="truncate">{m.name}</span>
              <span className="shrink-0 tabular-nums">
                ~{m.customers.toLocaleString()}
              </span>
            </li>
          ))}
          {more > 0 ? (
            <li className="px-7 pt-1 text-[11px] text-text-3">+{more} more</li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

function severityDot(customers: number): string {
  if (customers >= 10_000) return "bg-crit";
  if (customers >= 500) return "bg-warn";
  return "bg-ok";
}

export function useOutagesSummary(): {
  data: OutageSummary | null;
  loading: boolean;
  error: string | null;
} {
  const [data, setData] = useState<OutageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/outages/summary", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as OutageSummary;
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const t = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);
  return useMemo(() => ({ data, loading, error }), [data, loading, error]);
}
