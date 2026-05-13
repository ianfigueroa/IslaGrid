"use client";

// LayerRail.tsx now only exports types + the URL sync hook. The old
// left-side rail UI was replaced by LayerPills (bottom toolbar) + a
// More-drawer in the new chrome design. We keep this file so existing
// imports of `LayerKey` and `useLayerUrlState` keep working.

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export type LayerKey =
  | "municipalities"
  | "grid-now"
  | "generation"
  | "infrastructure"
  | "outage-risk"
  | "planned-work"
  | "reports"
  | "outages-live"
  | "weather-alerts"
  | "hurricane"
  | "quakes"
  | "solar"
  | "demand"
  | "rain-radar"
  | "wind";

const KNOWN: LayerKey[] = [
  "municipalities",
  "grid-now",
  "generation",
  "infrastructure",
  "outage-risk",
  "planned-work",
  "reports",
  "outages-live",
  "weather-alerts",
  "hurricane",
  "quakes",
  "solar",
  "demand",
  "rain-radar",
  "wind",
];

export function encodeLayers(active: Set<LayerKey>): string {
  return Array.from(active).sort().join(",");
}

export function decodeLayers(raw: string | null): Set<LayerKey> | null {
  if (!raw) return null;
  const known = new Set<LayerKey>(KNOWN);
  const parsed = new Set<LayerKey>();
  for (const part of raw.split(",")) {
    const trimmed = part.trim() as LayerKey;
    if (known.has(trimmed)) parsed.add(trimmed);
  }
  return parsed.size > 0 ? parsed : null;
}

export function useLayerUrlState(
  active: Set<LayerKey>,
  setActive: (next: Set<LayerKey>) => void,
): void {
  const router = useRouter();
  const params = useSearchParams();
  const initRef = useRef(false);

  // Read from URL on first mount.
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const decoded = decodeLayers(params.get("layers"));
    if (decoded) setActive(decoded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Write to URL when set changes.
  useEffect(() => {
    if (!initRef.current) return;
    const encoded = encodeLayers(active);
    const url = new URL(window.location.href);
    if (encoded) url.searchParams.set("layers", encoded);
    else url.searchParams.delete("layers");
    // Cast: same-origin URL we constructed from window.location; Next's typed
    // routes view doesn't know about runtime URLs.
    router.replace(
      `${url.pathname}${url.search}` as unknown as Parameters<typeof router.replace>[0],
      { scroll: false },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
