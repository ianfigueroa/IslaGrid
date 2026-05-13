"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, MessageSquareWarning, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { REPORT_TYPES, type ReportType } from "@/lib/reports";

interface Props {
  /**
   * Kept for back-compat with callers that still pass it; previously gated the
   * trigger behind a layer toggle, which made the button invisible by default
   * and broke "make a report" for new users. Reports are always submittable.
   */
  enabled?: boolean;
  /** Fires after a successful submit so the parent can refresh the map layer. */
  onSubmitted?: () => void;
}

type GeoState =
  | { kind: "idle" }
  | { kind: "asking" }
  | { kind: "ok"; lat: number; lon: number }
  | { kind: "denied"; message: string };

type SubmitState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "ok" }
  | { kind: "error"; message: string };

export function ReportSheet({ onSubmitted }: Props) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ReportType | null>(null);
  const [geo, setGeo] = useState<GeoState>({ kind: "idle" });
  const [submit, setSubmit] = useState<SubmitState>({ kind: "idle" });

  const close = useCallback(() => {
    setOpen(false);
    // Reset after the sheet finishes animating out.
    setTimeout(() => {
      setType(null);
      setGeo({ kind: "idle" });
      setSubmit({ kind: "idle" });
    }, 220);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  function askLocation() {
    if (!("geolocation" in navigator)) {
      setGeo({
        kind: "denied",
        message: "Your browser doesn't support geolocation.",
      });
      return;
    }
    setGeo({ kind: "asking" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({
          kind: "ok",
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
        });
      },
      (err) => {
        setGeo({
          kind: "denied",
          message: err.message || "Permission denied.",
        });
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
    );
  }

  async function send() {
    if (!type || geo.kind !== "ok") return;
    setSubmit({ kind: "sending" });
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, lat: geo.lat, lon: geo.lon }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setSubmit({ kind: "ok" });
      onSubmitted?.();
      setTimeout(close, 1200);
    } catch (err) {
      setSubmit({
        kind: "error",
        message: err instanceof Error ? err.message : "Send failed.",
      });
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Report a power issue"
        className="pointer-events-auto absolute right-3 top-44 z-30 flex h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-medium text-text shadow-lg transition-colors hover:bg-surface-2"
      >
        <MessageSquareWarning className="size-4 text-warn" aria-hidden />
        Report
      </button>

      <AnimatePresence>
        {open ? (
          <>
            <motion.div
              key="scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="pointer-events-auto absolute inset-0 z-40 bg-black/40"
              onClick={close}
            />
            <motion.aside
              key="sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Submit a community report"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 320 }}
              className="surface pointer-events-auto absolute inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-xl border-t border-line p-4 sm:left-1/2 sm:bottom-4 sm:w-[440px] sm:-translate-x-1/2 sm:rounded-xl sm:border"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">
                  Report what you&rsquo;re seeing
                </h2>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={close}
                  className="cursor-pointer rounded-md p-1 text-text-3 transition-colors hover:bg-surface-2 hover:text-text"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>

              <p className="mt-1 text-xs text-text-3">
                Reports are aggregated to ~5 km² hex cells. Your exact location
                is never stored or shown.
              </p>

              <fieldset className="mt-4">
                <legend className="text-[11px] font-mono uppercase tracking-wider text-text-3">
                  What&rsquo;s happening?
                </legend>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {REPORT_TYPES.map((meta) => {
                    const selected = meta.type === type;
                    return (
                      <button
                        key={meta.type}
                        type="button"
                        onClick={() => setType(meta.type)}
                        aria-pressed={selected}
                        className={cn(
                          "rounded-md border px-3 py-2 text-left text-sm transition-colors",
                          selected
                            ? "border-brand/60 bg-brand-soft text-text"
                            : "border-line bg-surface text-text-2 hover:bg-surface-2 hover:text-text",
                        )}
                      >
                        <div className="font-medium">{meta.label}</div>
                        <div className="text-[10px] text-text-3">
                          {meta.hint}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset className="mt-4">
                <legend className="text-[11px] font-mono uppercase tracking-wider text-text-3">
                  Location
                </legend>
                <div className="mt-2 rounded-md border border-line bg-surface p-3 text-sm">
                  {geo.kind === "idle" ? (
                    <button
                      type="button"
                      onClick={askLocation}
                      className="cursor-pointer text-text-2 underline-offset-2 hover:text-text hover:underline"
                    >
                      Use my current location
                    </button>
                  ) : geo.kind === "asking" ? (
                    <span className="text-text-3">Asking your browser…</span>
                  ) : geo.kind === "ok" ? (
                    <span className="inline-flex items-center gap-2 text-ok">
                      <Check className="size-4" aria-hidden />
                      Location captured (rounded to 5 km² before storing).
                    </span>
                  ) : (
                    <span className="text-warn">
                      Couldn&rsquo;t get your location: {geo.message}
                    </span>
                  )}
                </div>
              </fieldset>

              <div className="mt-5 flex items-center justify-between gap-3">
                <p className="text-[10px] text-text-3">
                  Submitting marks this as <span className="text-text-2">unverified community data</span>.
                </p>
                <button
                  type="button"
                  disabled={
                    !type ||
                    geo.kind !== "ok" ||
                    submit.kind === "sending" ||
                    submit.kind === "ok"
                  }
                  onClick={send}
                  aria-disabled={
                    !type || geo.kind !== "ok" || submit.kind !== "idle"
                  }
                  // WCAG AA needs >= 3:1 for disabled UI controls; the prior
                  // text-text-3 on bg-surface-2 was ~2.2:1 in dark mode.
                  // Use text-text-2 + border for an explicit affordance.
                  className={cn(
                    "min-h-11 rounded-md px-4 py-2 text-sm font-medium transition-colors",
                    !type || geo.kind !== "ok"
                      ? "cursor-not-allowed border border-line bg-surface-2 text-text-2"
                      : submit.kind === "ok"
                        ? "bg-ok/20 text-ok"
                        : "cursor-pointer bg-brand text-bg hover:bg-brand/90",
                  )}
                >
                  {submit.kind === "sending"
                    ? "Sending…"
                    : submit.kind === "ok"
                      ? "Sent"
                      : "Submit report"}
                </button>
              </div>

              {submit.kind === "error" ? (
                <p className="mt-2 text-xs text-warn">{submit.message}</p>
              ) : null}
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
}
