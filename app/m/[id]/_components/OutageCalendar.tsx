"use client";

import { useMemo } from "react";

interface Props {
  /** Dense [{date: 'YYYY-MM-DD', hours}] sorted ascending. */
  data: Array<{ date: string; hours: number }>;
}

/**
 * GitHub-style activity heatmap. Rows are day-of-week (Sun–Sat), columns
 * are weeks (oldest left, newest right). Color intensity = outage hours
 * that day. Uses CSS color stops, no chart library.
 */
export function OutageCalendar({ data }: Props) {
  const weeks = useMemo(() => bucketIntoWeeks(data), [data]);
  const max = useMemo(
    () => data.reduce((m, d) => (d.hours > m ? d.hours : m), 0),
    [data],
  );
  const monthLabels = useMemo(() => extractMonthLabels(weeks), [weeks]);

  return (
    <section className="card px-5 py-5">
      <header className="mb-3 flex items-baseline justify-between">
        <h3 className="text-[13px] font-semibold tracking-tight">
          Outage calendar
        </h3>
        <span className="text-[11px] text-text-3">
          Each square = one day · darker = more outage hours
        </span>
      </header>

      <div className="overflow-x-auto pb-1">
        <div className="inline-grid grid-flow-col grid-rows-[auto_repeat(7,1fr)] gap-[3px]">
          {/* Month labels row */}
          {monthLabels.map((label, i) => (
            <div
              key={`m-${i}`}
              className="row-span-1 text-[10px] text-text-3"
              style={{ minWidth: "10px" }}
            >
              {label}
            </div>
          ))}
          {/* 7 rows × N weeks of cells. We iterate cells column-major. */}
          {weeks.flatMap((week, wi) =>
            week.map((cell, di) => (
              <div
                key={`c-${wi}-${di}`}
                title={
                  cell
                    ? `${cell.date} — ${cell.hours.toFixed(1)} outage hours`
                    : ""
                }
                aria-label={cell ? `${cell.date}: ${cell.hours.toFixed(1)} outage hours` : "no data"}
                className="size-2.5 rounded-sm sm:size-3"
                style={{
                  backgroundColor: cell ? heatColor(cell.hours, max) : "transparent",
                }}
              />
            )),
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-[10.5px] text-text-3">
        <span>Less</span>
        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
          <span
            key={i}
            className="size-2.5 rounded-sm"
            style={{ backgroundColor: heatColor(t * (max || 1), max || 1) }}
            aria-hidden
          />
        ))}
        <span>More</span>
      </div>
    </section>
  );
}

interface DayCell {
  date: string;
  hours: number;
}

function bucketIntoWeeks(
  data: Array<{ date: string; hours: number }>,
): Array<Array<DayCell | null>> {
  if (data.length === 0) return [];
  // Align to Sunday: front-pad the first week with nulls so day-of-week rows
  // line up across the grid.
  const first = new Date(data[0].date);
  const firstDow = first.getUTCDay(); // 0 = Sun
  const weeks: Array<Array<DayCell | null>> = [];
  let current: Array<DayCell | null> = Array.from({ length: firstDow }, () => null);
  for (const d of data) {
    current.push({ date: d.date, hours: d.hours });
    if (current.length === 7) {
      weeks.push(current);
      current = [];
    }
  }
  while (current.length > 0 && current.length < 7) current.push(null);
  if (current.length === 7) weeks.push(current);
  return weeks;
}

function extractMonthLabels(weeks: Array<Array<DayCell | null>>): string[] {
  const out: string[] = [];
  let lastMonth = -1;
  for (const week of weeks) {
    const firstReal = week.find((c) => c) ?? null;
    if (!firstReal) {
      out.push("");
      continue;
    }
    const month = new Date(firstReal.date).getUTCMonth();
    if (month !== lastMonth) {
      out.push(
        new Date(firstReal.date).toLocaleDateString("en-US", { month: "short" }),
      );
      lastMonth = month;
    } else {
      out.push("");
    }
  }
  return out;
}

function heatColor(hours: number, max: number): string {
  if (max <= 0 || hours <= 0) return "var(--color-surface-2, #1f2937)";
  // 5 stops matching the legend below. Tuned for dark UI; renders OK on light too.
  const t = Math.min(1, hours / max);
  if (t <= 0.05) return "var(--color-surface-2, #1f2937)";
  if (t <= 0.25) return "#fde68a";
  if (t <= 0.5) return "#fbbf24";
  if (t <= 0.75) return "#f97316";
  return "#dc2626";
}
