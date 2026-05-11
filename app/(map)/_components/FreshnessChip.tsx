"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { freshnessState, formatAge, SOURCES, type SourceId } from "@/lib/sources";

interface Props {
  asOf: string;
  source: SourceId;
  className?: string;
}

/**
 * Load-bearing component: every public number renders one of these.
 * Ticks once a minute so the age stays current without re-fetching.
 */
export function FreshnessChip({ asOf, source, className }: Props) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const state = freshnessState(source, asOf);
  const meta = SOURCES[source];
  const age = formatAge(asOf);

  const tone =
    state === "fresh"
      ? "text-text-3"
      : state === "stale"
        ? "text-warn"
        : "text-crit";

  const dotTone =
    state === "fresh"
      ? "bg-ok/70"
      : state === "stale"
        ? "bg-warn/70 pulse-critical"
        : "bg-crit/80 pulse-critical";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-[11px] leading-none",
        tone,
        className,
      )}
      title={meta.url ?? meta.display}
    >
      <span className={cn("size-1.5 rounded-full", dotTone)} aria-hidden />
      <span>
        Updated {age} · {meta.label} · {meta.display}
      </span>
    </span>
  );
}
