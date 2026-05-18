"use client";

import { useEffect, useState } from "react";
import { Activity, Gauge, Power, TriangleAlert, Zap } from "lucide-react";
import { cn } from "@/lib/cn";

interface PlantDetail {
  id: string;
  name: string;
  fuel?: string | null;
  operator?: string | null;
  capacity_mw?: number | null;
  current_mw: number | null;
  available_mw: number | null;
  status: "online" | "offline" | "derated" | "unknown";
  utilization_pct: number | null;
  units: Array<{ category: string | null; mw: number; ts: string }>;
  history_24h?: Array<{ ts: string; mw: number }>;
  ts: string | null;
  matched: boolean;
  reason?:
    | "supabase_unconfigured"
    | "no_snapshot"
    | "unknown_plant"
    | "supabase_error";
}

interface Props {
  plantId: string;
  fallbackName?: string;
  fallbackFuel?: string | null;
  /**
   * OSM-only plants don't have curated capacity in our list, but the OSM
   * feature itself often carries a `capacity_mw` tag. The map passes that
   * through so we can still show a nameplate even when the API returns null.
   */
  fallbackCapacityMw?: number | null;
}

const STATUS_TONE: Record<PlantDetail["status"], { label: string; cls: string; Icon: typeof Power }> = {
  online: {
    label: "Online",
    cls: "border-ok/30 bg-ok-soft text-ok",
    Icon: Power,
  },
  derated: {
    label: "Derated",
    cls: "border-warn/30 bg-warn-soft text-warn",
    Icon: TriangleAlert,
  },
  offline: {
    label: "Offline",
    cls: "border-crit/30 bg-crit-soft text-crit",
    Icon: Power,
  },
  unknown: {
    label: "Unknown",
    cls: "border-line bg-surface-2 text-text-3",
    Icon: Activity,
  },
};

function fmtMw(mw: number | null | undefined): string {
  if (mw == null || !Number.isFinite(mw)) return "—";
  return `${Math.round(mw).toLocaleString("en-US")} MW`;
}

function fmtAge(iso: string | null): string {
  if (!iso) return "no reading";
  const ageMin = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60000);
  if (ageMin < 1) return "<1 min ago";
  if (ageMin < 60) return `${Math.round(ageMin)} min ago`;
  const ageHr = ageMin / 60;
  if (ageHr < 24) return `${ageHr.toFixed(1)} h ago`;
  return `${Math.round(ageHr / 24)} d ago`;
}

export function PlantSummary({
  plantId,
  fallbackName,
  fallbackFuel,
  fallbackCapacityMw,
}: Props) {
  const [detail, setDetail] = useState<PlantDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    const load = async () => {
      try {
        const res = await fetch(
          `/api/plants/${encodeURIComponent(plantId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as PlantDetail;
        if (!cancelled) setDetail(json);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load plant");
        }
      }
    };
    void load();
    // Refresh on the same cadence as the grid status pill — plant_snapshots
    // upserts together with the genera-pr.com scrape every ~5 min.
    const t = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [plantId]);

  if (error) {
    return (
      <div className="rounded-md border border-line bg-surface-2 p-3 text-xs text-text-2">
        Couldn&rsquo;t load live data for this plant ({error}).
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-2">
        <div className="h-5 w-32 animate-pulse rounded bg-surface-2" />
        <div className="h-4 w-48 animate-pulse rounded bg-surface-2" />
        <div className="h-16 w-full animate-pulse rounded bg-surface-2" />
      </div>
    );
  }

  const tone = STATUS_TONE[detail.status];
  const StatusIcon = tone.Icon;
  const fuel = detail.fuel ?? fallbackFuel ?? null;
  // Prefer API capacity (curated), fall back to whatever the map feature
  // brought in from OSM so OSM-only plants still show a nameplate.
  const effectiveCapacityMw =
    detail.capacity_mw != null ? detail.capacity_mw : fallbackCapacityMw ?? null;
  const rawUtilization =
    detail.utilization_pct != null
      ? detail.utilization_pct
      : effectiveCapacityMw && effectiveCapacityMw > 0 && detail.current_mw != null
        ? (detail.current_mw / effectiveCapacityMw) * 100
        : null;
  // Clamp display to 100% — when a plant temporarily exceeds nameplate we
  // shouldn't render "112%" like the bar is overflowing. Surface the raw
  // figure as a tooltip-friendly fact next to the bar.
  const utilization =
    rawUtilization != null ? Math.max(0, Math.min(100, rawUtilization)) : null;
  const utilizationExceedsNameplate =
    rawUtilization != null && rawUtilization > 100;
  const showCapacityBar =
    effectiveCapacityMw != null && effectiveCapacityMw > 0 && detail.current_mw != null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium uppercase tracking-wider",
            tone.cls,
          )}
        >
          <StatusIcon className="size-3.5" aria-hidden />
          {tone.label}
        </span>
        <span className="text-[10px] uppercase tracking-[0.16em] text-text-3">
          {fmtAge(detail.ts)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-md border border-line bg-surface p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-text-3">
            <Zap className="size-3" aria-hidden />
            Current output
          </div>
          <div className="mt-1 font-mono text-lg tabular-nums text-text">
            {fmtMw(detail.current_mw)}
          </div>
        </div>
        <div className="rounded-md border border-line bg-surface p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-text-3">
            <Gauge className="size-3" aria-hidden />
            Nameplate
          </div>
          <div className="mt-1 font-mono text-lg tabular-nums text-text-2">
            {fmtMw(effectiveCapacityMw)}
          </div>
        </div>
      </div>

      {detail.history_24h && detail.history_24h.length >= 3 ? (
        <PlantSparkline
          points={detail.history_24h}
          capacityMw={effectiveCapacityMw}
        />
      ) : null}

      {showCapacityBar ? (
        <div>
          <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-text-3">
            <span>Utilization</span>
            <span
              className="font-mono tabular-nums text-text-2"
              title={
                utilizationExceedsNameplate
                  ? "Current output exceeds the stated nameplate — likely co-located peakers or under-reported capacity."
                  : undefined
              }
            >
              {utilization != null ? `${utilization.toFixed(0)}%` : "—"}
              {utilizationExceedsNameplate ? "+" : ""}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                detail.status === "offline"
                  ? "bg-crit"
                  : detail.status === "derated"
                    ? "bg-warn"
                    : "bg-ok",
              )}
              style={{ width: `${utilization ?? 0}%` }}
            />
          </div>
        </div>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        {fuel ? (
          <div>
            <dt className="uppercase tracking-[0.12em] text-text-3">Fuel</dt>
            <dd className="font-mono text-sm capitalize text-text">{fuel}</dd>
          </div>
        ) : null}
        {detail.operator ? (
          <div>
            <dt className="uppercase tracking-[0.12em] text-text-3">Operator</dt>
            <dd className="font-mono text-sm text-text">{detail.operator}</dd>
          </div>
        ) : null}
      </dl>

      {detail.units.length > 1 ? (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-[0.16em] text-text-3">
            Units
          </div>
          <ul className="space-y-1">
            {detail.units.map((u, i) => (
              <li
                key={`${u.category ?? "unit"}-${i}`}
                className="flex items-center justify-between rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-xs"
              >
                <span className="capitalize text-text-2">
                  {u.category ?? "Unit"}
                </span>
                <span className="font-mono tabular-nums text-text">
                  {fmtMw(u.mw)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {detail.reason === "no_snapshot" ? (
        <p className="rounded-md border border-line bg-surface-2 p-2.5 text-xs text-text-3">
          No live reading available for{" "}
          {detail.name || fallbackName || "this plant"}. We track Genera PR&rsquo;s
          fleet (~25 stations); smaller operators don&rsquo;t publish per-plant
          telemetry yet.
        </p>
      ) : null}

      <p className="text-[10px] text-text-3">
        Source: genera-pr.com · refreshed every 5 min · capacity figures are
        approximate nameplate.
      </p>
    </div>
  );
}

interface SparklineProps {
  points: Array<{ ts: string; mw: number }>;
  capacityMw: number | null;
}

/**
 * 24h output sparkline for the selected plant. SVG only, no chart lib. The
 * faint horizontal line is the curated nameplate when known — gives users a
 * visual reference for how hard the plant is running relative to design.
 */
function PlantSparkline({ points, capacityMw }: SparklineProps) {
  if (points.length < 2) return null;
  const width = 280;
  const height = 56;
  const padTop = 6;
  const padBottom = 4;
  const innerH = height - padTop - padBottom;
  const maxMw = Math.max(
    1,
    capacityMw && capacityMw > 0
      ? capacityMw
      : points.reduce((m, p) => (p.mw > m ? p.mw : m), 0),
  );
  const stepX = width / (points.length - 1);
  const coords = points.map((p, i) => ({
    x: i * stepX,
    y: padTop + (1 - Math.max(0, p.mw) / maxMw) * innerH,
    mw: p.mw,
    ts: p.ts,
  }));
  const linePath = coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L ${coords[coords.length - 1].x},${height - padBottom} L 0,${height - padBottom} Z`;
  const capacityY =
    capacityMw && capacityMw > 0 && capacityMw <= maxMw
      ? padTop + (1 - capacityMw / maxMw) * innerH
      : null;

  const firstTs = new Date(points[0].ts);
  const lastTs = new Date(points[points.length - 1].ts);
  const fmtHour = (d: Date) =>
    d.toLocaleTimeString("en-US", { hour: "numeric", hour12: true });

  return (
    <div>
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-text-3">
        <span>Last 24 h</span>
        <span className="font-mono tabular-nums">
          {fmtHour(firstTs)} → {fmtHour(lastTs)}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="mt-1.5 h-14 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`24-hour output: ${Math.round(points[0].mw)} to ${Math.round(points[points.length - 1].mw)} MW`}
      >
        <defs>
          <linearGradient id="plantArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#10b981" stopOpacity="0.35" />
            <stop offset="1" stopColor="#10b981" stopOpacity="0" />
          </linearGradient>
        </defs>
        {capacityY !== null ? (
          <line
            x1="0"
            x2={width}
            y1={capacityY}
            y2={capacityY}
            stroke="currentColor"
            strokeOpacity="0.25"
            strokeDasharray="3 3"
            className="text-text-3"
          />
        ) : null}
        <path d={areaPath} fill="url(#plantArea)" />
        <path
          d={linePath}
          fill="none"
          stroke="#10b981"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
