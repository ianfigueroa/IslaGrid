"use client";

import { useMemo } from "react";

interface Props {
  /** 0..100 percentile. Higher = worse, per Lumatrack convention. */
  percentile: number;
  /** Total outage hours for this muni in the selected window. */
  totalHours: number;
  /** Island-wide median outage hours in the same window — anchor for "are
   *  we normal?". */
  islandMedianHours: number;
}

/**
 * Animated circular gauge for the reliability percentile. SVG-only, no chart
 * library. Color ramps from green (best) → red (worst) so the user can read
 * the severity even with the number muted.
 */
export function ReliabilityScore({
  percentile,
  totalHours,
  islandMedianHours,
}: Props) {
  const safe = Math.max(0, Math.min(100, Math.round(percentile)));
  const { stroke, label } = useMemo(() => toneFor(safe), [safe]);
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const dash = (safe / 100) * circumference;
  const compare = useMemo(
    () => compareToIsland(totalHours, islandMedianHours),
    [totalHours, islandMedianHours],
  );

  return (
    <section className="card flex flex-col items-center gap-3 px-6 py-7">
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-3">
        Reliability score
      </span>
      <div className="relative grid place-items-center">
        <svg
          width="180"
          height="180"
          viewBox="0 0 180 180"
          aria-label={`Reliability score ${safe} out of 100`}
        >
          <circle
            cx="90"
            cy="90"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="10"
            className="text-line"
          />
          <circle
            cx="90"
            cy="90"
            r={radius}
            fill="none"
            stroke={stroke}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            transform="rotate(-90 90 90)"
            style={{ transition: "stroke-dasharray 600ms ease" }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center leading-none">
            <span
              className="text-[44px] font-semibold tabular-nums"
              style={{ color: stroke }}
            >
              {safe}
            </span>
            <span className="text-[11px] text-text-3">/100</span>
          </div>
        </div>
      </div>
      <p className="text-center text-[12.5px] text-text-2">
        {label}
      </p>
      {compare ? (
        <p className="text-center text-[11.5px] text-text-3">
          {compare}
        </p>
      ) : null}
    </section>
  );
}

function compareToIsland(totalHours: number, median: number): string | null {
  if (median <= 0 || totalHours <= 0) return null;
  const ratio = totalHours / median;
  const islandLabel = `${Math.round(median).toLocaleString()} h island median`;
  if (ratio >= 1.25) {
    const pct = Math.round((ratio - 1) * 100);
    return `${Math.round(totalHours).toLocaleString()} h here · ${pct}% above the ${islandLabel}.`;
  }
  if (ratio <= 0.8) {
    const pct = Math.round((1 - ratio) * 100);
    return `${Math.round(totalHours).toLocaleString()} h here · ${pct}% below the ${islandLabel}.`;
  }
  return `${Math.round(totalHours).toLocaleString()} h here · roughly in line with the ${islandLabel}.`;
}

function toneFor(score: number): { stroke: string; label: string } {
  // Higher = worse, so the comparison reads as "less reliable than X% of PR".
  if (score >= 75) {
    return {
      stroke: "#ef4444",
      label: `Your neighborhood is less reliable than ${score}% of Puerto Rico.`,
    };
  }
  if (score >= 50) {
    return {
      stroke: "#f97316",
      label: `Your neighborhood is less reliable than ${score}% of Puerto Rico.`,
    };
  }
  if (score >= 25) {
    return {
      stroke: "#eab308",
      label: `Your neighborhood is less reliable than ${score}% of Puerto Rico.`,
    };
  }
  return {
    stroke: "#10b981",
    label: `Your neighborhood is more reliable than ${100 - score}% of Puerto Rico.`,
  };
}
