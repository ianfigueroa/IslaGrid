"use client";

import { useMemo, useRef, useState } from "react";

interface Props {
  data: Array<{ month: string; hours: number }>;
}

interface HoverPoint {
  idx: number;
  x: number;
  y: number;
}

/**
 * Lightweight area+line chart with no chart library. The pointer moves a
 * crosshair across the months and the tooltip pins to the nearest data point
 * so users can read exact hours without us pulling Recharts in for one panel.
 */
export function MonthlyHoursChart({ data }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<HoverPoint | null>(null);

  const built = useMemo(() => buildPath(data, 600, 180), [data]);

  if (data.length === 0) {
    return (
      <section className="card grid place-items-center px-5 py-10 text-[12px] text-text-3">
        No outage data for this window yet.
      </section>
    );
  }

  const { path, areaPath, maxY, points, gridLines } = built;
  const activePoint = hover ? points[hover.idx] : null;
  const activeData = hover ? data[hover.idx] : null;

  return (
    <section className="card relative px-5 py-5">
      <header className="mb-3 flex items-baseline justify-between">
        <h3 className="text-[13px] font-semibold tracking-tight">
          Outage hours by month
        </h3>
        <span className="text-[11px] text-text-3 tabular-nums">
          Peak: {Math.round(maxY)} h
        </span>
      </header>
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox="0 0 600 180"
          className="h-[180px] w-full"
          preserveAspectRatio="none"
          aria-label="Monthly outage hours"
          onMouseMove={(e) => {
            const svg = svgRef.current;
            if (!svg || points.length === 0) return;
            const rect = svg.getBoundingClientRect();
            // Translate pointer x into the 0..600 viewBox.
            const localX = ((e.clientX - rect.left) / rect.width) * 600;
            let bestIdx = 0;
            let bestDx = Infinity;
            for (let i = 0; i < points.length; i++) {
              const dx = Math.abs(points[i].x - localX);
              if (dx < bestDx) {
                bestDx = dx;
                bestIdx = i;
              }
            }
            setHover({
              idx: bestIdx,
              x: points[bestIdx].x,
              y: points[bestIdx].y,
            });
          }}
          onMouseLeave={() => setHover(null)}
        >
          {gridLines.map((g, i) => (
            <line
              key={`g-${i}`}
              x1="0"
              x2="600"
              y1={g.y}
              y2={g.y}
              stroke="currentColor"
              strokeOpacity="0.08"
              className="text-text-3"
            />
          ))}
          <defs>
            <linearGradient id="outageAreaFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#ef4444" stopOpacity="0.32" />
              <stop offset="1" stopColor="#ef4444" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#outageAreaFill)" />
          <path
            d={path}
            fill="none"
            stroke="#ef4444"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {points.map((p, i) => (
            <circle
              key={`p-${i}`}
              cx={p.x}
              cy={p.y}
              r={hover?.idx === i ? 4 : 2.5}
              fill="#ef4444"
            />
          ))}
          {activePoint ? (
            <line
              x1={activePoint.x}
              x2={activePoint.x}
              y1={0}
              y2={180}
              stroke="#ef4444"
              strokeOpacity="0.3"
              strokeDasharray="3 3"
            />
          ) : null}
        </svg>
        {activePoint && activeData ? (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11px] text-text shadow-lg"
            style={{
              left: `${(activePoint.x / 600) * 100}%`,
              top: 0,
              transform: "translate(-50%, -110%)",
            }}
          >
            <div className="font-medium">{formatMonthLong(activeData.month)}</div>
            <div className="font-mono tabular-nums text-text-2">
              {activeData.hours > 0
                ? `${activeData.hours.toFixed(1)} outage hours`
                : "No outages logged"}
            </div>
          </div>
        ) : null}
        <div className="mt-1 flex justify-between text-[10.5px] text-text-3">
          {data.map((d) => (
            <span key={d.month} className="tabular-nums">
              {formatMonth(d.month)}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function formatMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  if (!y || !m) return yearMonth;
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function formatMonthLong(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  if (!y || !m) return yearMonth;
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function buildPath(
  data: Array<{ month: string; hours: number }>,
  width: number,
  height: number,
): {
  path: string;
  areaPath: string;
  maxY: number;
  points: Array<{ x: number; y: number }>;
  gridLines: Array<{ y: number }>;
} {
  if (data.length === 0) {
    return { path: "", areaPath: "", maxY: 0, points: [], gridLines: [] };
  }
  const maxRaw = data.reduce((m, d) => (d.hours > m ? d.hours : m), 0);
  const maxY = niceCeil(maxRaw);
  const padTop = 16;
  const padBottom = 14;
  const innerH = height - padTop - padBottom;
  const stepX = data.length === 1 ? 0 : width / (data.length - 1);
  const points = data.map((d, i) => ({
    x: data.length === 1 ? width / 2 : i * stepX,
    y: padTop + (1 - d.hours / (maxY || 1)) * innerH,
  }));
  // Smooth cubic path between consecutive points.
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const midX = (prev.x + cur.x) / 2;
    path += ` C ${midX} ${prev.y}, ${midX} ${cur.y}, ${cur.x} ${cur.y}`;
  }
  const areaPath =
    `${path} L ${points[points.length - 1].x} ${height - padBottom} L ${points[0].x} ${height - padBottom} Z`;
  const gridLines = [0.25, 0.5, 0.75, 1].map((t) => ({
    y: padTop + (1 - t) * innerH,
  }));
  return { path, areaPath, maxY, points, gridLines };
}

function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const pow10 = Math.pow(10, Math.floor(Math.log10(value)));
  const norm = value / pow10;
  let nice = 1;
  if (norm > 5) nice = 10;
  else if (norm > 2) nice = 5;
  else if (norm > 1) nice = 2;
  return nice * pow10;
}
