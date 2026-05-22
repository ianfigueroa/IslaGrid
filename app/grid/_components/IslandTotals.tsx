import { cn } from "@/lib/cn";
import { formatAge, SOURCES, type SourceId } from "@/lib/sources";
import type { GridSnapshot } from "@/lib/supabase";

const STATUS_TONE: Record<string, string> = {
  normal: "text-ok",
  watch: "text-warn",
  strained: "text-warn",
  critical: "text-crit",
  stale: "text-text-3",
  unknown: "text-text-3",
};

const STATUS_LABEL: Record<string, string> = {
  normal: "Operating normally",
  watch: "Watch",
  strained: "Strained",
  critical: "Critical",
  stale: "Awaiting fresh data",
  unknown: "Status unknown",
};

// Plain-language definitions surfaced as `title` tooltips on the metric
// labels. LUMA and Genera each use these terms slightly differently and the
// dashboard has historically been silent about which definition it's
// publishing — these match the merge-grid priority order (LUMA wins for
// demand/reserve; Genera wins for generation/capacity).
const METRIC_HINT: Record<string, string> = {
  Demand: "Current system load (MW). Source: LUMA Resumen del Sistema.",
  Generation: "Sum of plant outputs reported by Genera right now (MW). Excludes plants with no recent feed.",
  Reserve: "Operational reserve: spare generation available within minutes (MW). LUMA's published number.",
  Capacity: "Available capacity: total generation that *could* be online if needed (MW). Genera when available, else demand + reserve.",
  "Next hour": "LUMA's forecast of demand for the next hour (MW).",
  "Peak fcst": "LUMA's forecast of today's peak demand (MW).",
};

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return Math.round(n).toLocaleString();
}

function sourceDisplay(source: string | null | undefined): string {
  if (!source) return "—";
  // Sources table covers official IDs; fall back to the raw string for
  // anything new that hasn't been registered yet.
  const meta = SOURCES[source as SourceId];
  return meta?.display ?? source;
}

interface Props {
  snapshot: GridSnapshot | null;
}

/**
 * Hero card at the top of /grid. Mirrors the same metrics as the right-side
 * StatusPanel sidebar so the two surfaces agree at a glance.
 */
export function IslandTotals({ snapshot }: Props) {
  const status = snapshot?.status ?? "unknown";
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-col leading-tight">
          <span className="text-[10px] uppercase tracking-[0.18em] text-text-3">
            Puerto Rico grid
          </span>
          <span
            className={cn(
              "text-[18px] font-semibold tracking-tight",
              STATUS_TONE[status] ?? STATUS_TONE.unknown,
            )}
          >
            {STATUS_LABEL[status] ?? STATUS_LABEL.unknown}
          </span>
        </div>
        <span
          className="text-[11px] text-text-3"
          title={
            snapshot?.source
              ? `Authoritative source for the merged snapshot. Click "View sources" on the methodology page for the per-field breakdown.`
              : undefined
          }
        >
          Source: <span className="text-text-2">{sourceDisplay(snapshot?.source)}</span>
          {" · "}
          {snapshot?.ts ? formatAge(snapshot.ts) : "no snapshot"}
        </span>
      </header>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Demand"     value={fmt(snapshot?.current_demand_mw)} />
        <Metric label="Generation" value={fmt(snapshot?.total_generation_mw)} />
        <Metric label="Reserve"    value={fmt(snapshot?.operational_reserve_mw)} />
        <Metric label="Capacity"   value={fmt(snapshot?.available_capacity_mw)} muted />
        <Metric label="Next hour"  value={fmt(snapshot?.next_hour_demand_mw)} muted />
        <Metric label="Peak fcst"  value={fmt(snapshot?.peak_demand_forecast_mw)} muted />
      </dl>

      {snapshot?.status_reasons && snapshot.status_reasons.length > 0 ? (
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {snapshot.status_reasons.map((r, i) => (
            <li
              key={i}
              className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-text-2"
            >
              {r}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Metric({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col leading-tight">
      <dt
        className="text-[9.5px] uppercase tracking-wider text-text-3"
        title={METRIC_HINT[label]}
      >
        {label}
        {METRIC_HINT[label] ? (
          <span className="ml-1 cursor-help text-text-3/60" aria-hidden>
            ⓘ
          </span>
        ) : null}
      </dt>
      <dd
        className={cn(
          "font-semibold tabular-nums",
          muted ? "text-[15px] text-text-2" : "text-[20px] text-text",
        )}
      >
        {value}
        <span className="ml-0.5 text-[9.5px] font-normal text-text-3">MW</span>
      </dd>
    </div>
  );
}
