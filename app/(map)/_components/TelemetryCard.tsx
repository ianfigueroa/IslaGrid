import { cn } from "@/lib/cn";
import { FreshnessChip } from "./FreshnessChip";
import type { SourceId } from "@/lib/sources";

interface Props {
  label: string;
  value: number | null | undefined;
  unit?: string;
  asOf?: string | null;
  source?: SourceId;
  tone?: "default" | "warn" | "crit" | "ok" | "neutral";
  className?: string;
  /** When true, render a shimmer skeleton in place of the value. */
  loading?: boolean;
}

const TONE: Record<NonNullable<Props["tone"]>, string> = {
  default: "text-text",
  warn: "text-warn",
  crit: "text-crit",
  ok: "text-ok",
  neutral: "text-text-2",
};

function formatMw(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function TelemetryCard({
  label,
  value,
  unit = "MW",
  asOf,
  source,
  tone = "default",
  className,
  loading,
}: Props) {
  return (
    <div className={cn("flex min-w-[120px] flex-col justify-center gap-0.5 px-3", className)}>
      <span className="text-[9px] uppercase tracking-[0.14em] text-text-3 leading-none">
        {label}
      </span>
      {loading ? (
        <span
          aria-busy="true"
          aria-label={`${label} loading`}
          className="mt-0.5 inline-block h-[1.1rem] w-16 animate-pulse rounded bg-surface-2"
        />
      ) : (
        <span className={cn("fade-in font-mono text-base font-medium leading-tight tabular-nums", TONE[tone])} key={String(value)}>
          {formatMw(value)}
          <span className="ml-1 text-[10px] text-text-3">{unit}</span>
        </span>
      )}
      {asOf && source && !loading ? <FreshnessChip asOf={asOf} source={source} /> : null}
    </div>
  );
}
