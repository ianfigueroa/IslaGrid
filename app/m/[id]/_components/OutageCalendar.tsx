"use client";

import { useMemo, useState } from "react";

interface Props {
  /** Dense [{date: 'YYYY-MM-DD', hours}] sorted ascending. */
  data: Array<{ date: string; hours: number }>;
}

interface DayCell {
  date: string;
  hours: number;
}

interface WeekColumn {
  cells: Array<DayCell | null>;
  /** First month name to print above this column, or null to leave it blank. */
  monthLabel: string | null;
}

/**
 * GitHub-style activity heatmap. Each column is one week (Sun→Sat top to
 * bottom). Color intensity = outage hours that day. Hover any cell to see
 * the exact date + hours in a floating tooltip.
 *
 * Previous version stacked all the month labels first then all 7×N day cells
 * inside the same CSS grid — with grid-flow-col the labels piled into the
 * first columns and the day cells started rendering at whatever column the
 * labels finished on, which looked like the layout had imploded. Each column
 * is now its own little flex stack so labels and squares can't drift apart.
 */
export function OutageCalendar({ data }: Props) {
  const weeks = useMemo(() => bucketIntoWeeks(data), [data]);
  const max = useMemo(
    () => data.reduce((m, d) => (d.hours > m ? d.hours : m), 0),
    [data],
  );
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    cell: DayCell;
  } | null>(null);

  return (
    <section className="card relative px-5 py-5">
      <header className="mb-3 flex items-baseline justify-between">
        <h3 className="text-[13px] font-semibold tracking-tight">
          Outage calendar
        </h3>
        <span className="text-[11px] text-text-3">
          Each square = one day · darker = more outage hours · hover for details
        </span>
      </header>

      <div className="overflow-x-auto pb-1">
        <div className="inline-flex gap-[3px]">
          {weeks.map((week, wi) => (
            <div key={`w-${wi}`} className="flex flex-col gap-[3px]">
              <span className="h-3 text-[10px] leading-3 text-text-3">
                {week.monthLabel ?? ""}
              </span>
              {week.cells.map((cell, di) => (
                <button
                  type="button"
                  key={`c-${wi}-${di}`}
                  disabled={!cell}
                  onMouseEnter={(e) => {
                    if (!cell) return;
                    const r = e.currentTarget.getBoundingClientRect();
                    setHover({
                      x: r.left + r.width / 2,
                      y: r.top,
                      cell,
                    });
                  }}
                  onMouseLeave={() => setHover(null)}
                  onFocus={(e) => {
                    if (!cell) return;
                    const r = e.currentTarget.getBoundingClientRect();
                    setHover({
                      x: r.left + r.width / 2,
                      y: r.top,
                      cell,
                    });
                  }}
                  onBlur={() => setHover(null)}
                  aria-label={
                    cell
                      ? `${cell.date}: ${cell.hours.toFixed(1)} outage hours`
                      : "no data"
                  }
                  className="size-3 rounded-sm transition-transform hover:scale-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand sm:size-3.5"
                  style={{
                    backgroundColor: cell
                      ? heatColor(cell.hours, max)
                      : "transparent",
                  }}
                />
              ))}
            </div>
          ))}
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

      {hover ? (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11px] text-text shadow-lg"
          style={{ left: hover.x, top: hover.y - 6 }}
        >
          <div className="font-medium">{formatDate(hover.cell.date)}</div>
          <div className="font-mono tabular-nums text-text-2">
            {hover.cell.hours > 0
              ? `${hover.cell.hours.toFixed(1)} outage hours`
              : "No outage logged"}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function bucketIntoWeeks(
  data: Array<{ date: string; hours: number }>,
): WeekColumn[] {
  if (data.length === 0) return [];
  // Align to Sunday: front-pad the first week with nulls so day-of-week rows
  // line up across the grid.
  const first = new Date(data[0].date);
  const firstDow = first.getUTCDay(); // 0 = Sun
  const weeks: WeekColumn[] = [];
  let currentCells: Array<DayCell | null> = Array.from(
    { length: firstDow },
    () => null,
  );
  for (const d of data) {
    currentCells.push({ date: d.date, hours: d.hours });
    if (currentCells.length === 7) {
      weeks.push({ cells: currentCells, monthLabel: null });
      currentCells = [];
    }
  }
  if (currentCells.length > 0) {
    while (currentCells.length < 7) currentCells.push(null);
    weeks.push({ cells: currentCells, monthLabel: null });
  }

  // Decide which columns show a month label: the first week of each calendar
  // month gets one. Skips the very first week if the next week also starts a
  // new month (avoids cramped duplicate labels).
  let lastMonth = -1;
  for (const w of weeks) {
    const firstReal = w.cells.find((c): c is DayCell => c !== null);
    if (!firstReal) continue;
    const month = new Date(firstReal.date).getUTCMonth();
    if (month !== lastMonth) {
      w.monthLabel = new Date(firstReal.date).toLocaleDateString("en-US", {
        month: "short",
      });
      lastMonth = month;
    }
  }
  return weeks;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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
