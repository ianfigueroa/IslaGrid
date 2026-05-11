import { cn } from "@/lib/cn";
import type { GridSnapshot } from "@/lib/supabase";
import { FreshnessChip } from "./FreshnessChip";
import type { SourceId } from "@/lib/sources";

interface Props {
  snapshot: GridSnapshot;
}

/**
 * Body rendered inside the intelligence panel when the user opens grid
 * status details. Honest about the heuristic and shows the input numbers
 * used by `risk.classify()`.
 */
export function GridStatusDetails({ snapshot }: Props) {
  const source = snapshot.source as SourceId;
  const rows: Array<{ label: string; value: number | null | undefined; unit?: string }> = [
    { label: "Current demand", value: snapshot.current_demand_mw, unit: "MW" },
    { label: "Next-hour demand", value: snapshot.next_hour_demand_mw, unit: "MW" },
    { label: "Total generation", value: snapshot.total_generation_mw, unit: "MW" },
    { label: "Available capacity", value: snapshot.available_capacity_mw, unit: "MW" },
    { label: "Operational reserve", value: snapshot.operational_reserve_mw, unit: "MW" },
    { label: "Spinning reserve", value: snapshot.spinning_reserve_mw, unit: "MW" },
    { label: "Peak demand forecast", value: snapshot.peak_demand_forecast_mw, unit: "MW" },
    { label: "Peak reserve forecast", value: snapshot.peak_reserve_forecast_mw, unit: "MW" },
  ];

  return (
    <div className="space-y-4 text-sm">
      {snapshot.status_reasons.length > 0 ? (
        <section>
          <h3 className="mb-2 text-[10px] uppercase tracking-[0.12em] text-text-3">
            Why
          </h3>
          <ul className="space-y-1.5">
            {snapshot.status_reasons.map((r, i) => (
              <li
                key={i}
                className={cn(
                  "rounded-md border border-line bg-surface-2/50 px-3 py-2 text-text",
                )}
              >
                {r}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h3 className="mb-2 text-[10px] uppercase tracking-[0.12em] text-text-3">
          Inputs
        </h3>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
          {rows.map((r) => (
            <div key={r.label} className="flex flex-col gap-0.5">
              <dt className="text-[10px] uppercase tracking-wider text-text-3">
                {r.label}
              </dt>
              <dd className="font-mono text-base tabular-nums text-text">
                {r.value == null ? "—" : r.value.toLocaleString("en-US")}
                {r.value != null ? (
                  <span className="ml-1 text-[10px] text-text-3">{r.unit}</span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="border-t border-line pt-3 text-xs text-text-3">
        <p>
          Status is computed by a transparent heuristic in{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-text-2">
            ingestion/src/pipeline/risk.py
          </code>
          . No ML at v1.
        </p>
        <div className="mt-2">
          <FreshnessChip asOf={snapshot.ts} source={source} />
        </div>
        {snapshot.source_stale ? (
          <p className="mt-2 text-warn">
            Source reports its backend is in maintenance — numbers above may
            be stale.
          </p>
        ) : null}
      </section>
    </div>
  );
}
