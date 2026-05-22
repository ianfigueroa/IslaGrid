"use client";

import { useEffect, useState } from "react";
import { seedRate, type RateBreakdown, type RateCategory } from "@/lib/rates";

/**
 * Fetches the live PREB rate for a category from /api/rates/current and
 * falls back to the frozen seed when the network is unavailable or PREB
 * data hasn't been ingested yet. Previously each consumer (Bill, Solar)
 * inlined the same fetch/setState/fallback dance; centralizing it here
 * means a rate refresh is one PR instead of three.
 *
 * Returns the current rate, a loading flag, and whether we're serving the
 * frozen seed (`isSeed` true means UI should mark the number as
 * "estimated from Q1 2026 PREB rate").
 */
export interface UseCurrentRateResult {
  rate: RateBreakdown;
  isLoading: boolean;
  isSeed: boolean;
}

export function useCurrentRate(category: RateCategory): UseCurrentRateResult {
  const [rate, setRate] = useState<RateBreakdown>(() => seedRate(category));
  const [isLoading, setIsLoading] = useState(true);
  const [isSeed, setIsSeed] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/rates/current?category=${encodeURIComponent(category)}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { rate?: RateBreakdown };
        if (!cancelled && json.rate) {
          setRate(json.rate);
          setIsSeed(false);
        }
      } catch {
        // Keep the seed — `isSeed` stays true so the caller can label it.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [category]);

  return { rate, isLoading, isSeed };
}
