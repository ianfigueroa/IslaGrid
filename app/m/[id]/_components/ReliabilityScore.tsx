"use client";

import { useMemo } from "react";

interface Props {
  /** 0..100 percentile. Higher = worse, per Lumatrack convention. */
  percentile: number;
}

/**
 * Animated circular gauge for the reliability percentile. SVG-only, no chart
 * library. Color ramps from green (best) → red (worst) so the user can read
 * the severity even with the number muted.
 */
export function ReliabilityScore({ percentile }: Props) {
  const safe = Math.max(0, Math.min(100, Math.round(percentile)));
  const { stroke, label } = useMemo(() => toneFor(safe), [safe]);
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const dash = (safe / 100) * circumference;

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
    </section>
  );
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
