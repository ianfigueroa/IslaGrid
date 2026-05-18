"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { formatAge } from "@/lib/sources";
import { fuelColor, fuelLabel } from "@/lib/fuel-colors";

const STATUS_TONE: Record<string, string> = {
  online: "text-ok",
  derated: "text-warn",
  offline: "text-crit",
  idle: "text-text-3",
  no_feed: "text-text-3",
  unknown: "text-text-3",
};

const NO_DATA_LABEL: Record<string, { headline: string; sub: string }> = {
  idle:    { headline: "Idle",    sub: "not running" },
  no_feed: { headline: "—",       sub: "no public feed" },
  unknown: { headline: "—",       sub: "no data" },
};

export interface PlantRow {
  id: string;
  name: string;
  operator: string;
  fuel: string;
  capacity_mw: number;
  current_mw: number | null;
  utilization_pct: number | null;
  status: "online" | "derated" | "offline" | "idle" | "no_feed" | "unknown";
  ts: string | null;
}

type SortKey = "name" | "fuel" | "capacity" | "output" | "utilization";

interface Props {
  plants: PlantRow[];
}

export function PlantsTable({ plants }: Props) {
  const [sort, setSort] = useState<SortKey>("output");
  const [dir, setDir] = useState<1 | -1>(-1);

  const sorted = useMemo(() => {
    const copy = [...plants];
    copy.sort((a, b) => {
      const cmp = (() => {
        switch (sort) {
          case "name":
            return a.name.localeCompare(b.name);
          case "fuel":
            return a.fuel.localeCompare(b.fuel);
          case "capacity":
            return a.capacity_mw - b.capacity_mw;
          case "output":
            return (a.current_mw ?? -1) - (b.current_mw ?? -1);
          case "utilization":
            return (a.utilization_pct ?? -1) - (b.utilization_pct ?? -1);
        }
      })();
      return cmp * dir;
    });
    return copy;
  }, [plants, sort, dir]);

  function toggle(key: SortKey) {
    if (key === sort) {
      setDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSort(key);
      setDir(key === "name" || key === "fuel" ? 1 : -1);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line">
      <table className="w-full text-[13px]">
        <thead className="bg-surface text-[11px] uppercase tracking-wider text-text-3">
          <tr>
            <Th onClick={() => toggle("name")} active={sort === "name"} dir={dir}>
              Plant
            </Th>
            <Th onClick={() => toggle("fuel")} active={sort === "fuel"} dir={dir}>
              Fuel
            </Th>
            <Th
              onClick={() => toggle("capacity")}
              active={sort === "capacity"}
              dir={dir}
              align="right"
            >
              Capacity
            </Th>
            <Th
              onClick={() => toggle("output")}
              active={sort === "output"}
              dir={dir}
              align="right"
            >
              Output
            </Th>
            <Th
              onClick={() => toggle("utilization")}
              active={sort === "utilization"}
              dir={dir}
              align="left"
            >
              Utilization
            </Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {sorted.map((p) => (
            <tr
              key={p.id}
              className="bg-surface/40 transition-colors hover:bg-surface-2"
            >
              <td className="px-3 py-2.5">
                <div className="flex flex-col leading-tight">
                  <span className="font-medium text-text">{p.name}</span>
                  <span className="text-[11px] text-text-3">{p.operator}</span>
                </div>
              </td>
              <td className="px-3 py-2.5">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{ backgroundColor: fuelColor(p.fuel) }}
                  />
                  <span className="text-text-2">
                    {fuelLabel(p.fuel)}
                  </span>
                </span>
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-text-2">
                {p.capacity_mw.toLocaleString()} MW
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">
                {p.current_mw == null ? (
                  <span className={cn("text-text-3", STATUS_TONE[p.status])}>
                    {NO_DATA_LABEL[p.status]?.headline ?? "—"}
                  </span>
                ) : (
                  <span className={cn("font-semibold", STATUS_TONE[p.status])}>
                    {Math.round(p.current_mw).toLocaleString()} MW
                  </span>
                )}
                <div className="mt-0.5 text-[10.5px] text-text-3">
                  {p.ts
                    ? formatAge(p.ts)
                    : NO_DATA_LABEL[p.status]?.sub ?? "no data"}
                </div>
              </td>
              <td className="w-[28%] px-3 py-2.5">
                <UtilBar
                  pct={p.utilization_pct}
                  fuel={p.fuel}
                  currentMw={p.current_mw}
                  capacityMw={p.capacity_mw}
                />
              </td>
            </tr>
          ))}
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-3 py-10 text-center text-text-3">
                No plant data loaded.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  onClick,
  active,
  dir,
  align = "left",
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  dir: 1 | -1;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={cn(
        "px-3 py-2.5 font-semibold",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:text-text",
          active ? "text-text" : "",
        )}
      >
        {children}
        {active ? (
          <span aria-hidden className="text-[9px]">
            {dir === 1 ? "▲" : "▼"}
          </span>
        ) : null}
      </button>
    </th>
  );
}

function UtilBar({
  pct,
  fuel,
  currentMw,
  capacityMw,
}: {
  pct: number | null;
  fuel: string;
  currentMw: number | null;
  capacityMw: number;
}) {
  if (pct == null) {
    return <span className="text-[11px] text-text-3">—</span>;
  }
  const color = fuelColor(fuel);
  const clamped = Math.max(0, Math.min(100, pct));
  // Tooltip surfaces the exact numbers the bar represents — Genera's gauge
  // value, nameplate capacity, and the percentage utilization — so hovering
  // is enough to read the row without expanding anything.
  const tooltip = `${Math.round(currentMw ?? 0).toLocaleString()} MW of ${capacityMw.toLocaleString()} MW nameplate (${Math.round(pct)}%)`;
  return (
    <div className="group flex items-center gap-2" title={tooltip}>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
        <span
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300"
          style={{ width: `${clamped}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-9 text-right text-[11px] tabular-nums text-text-2">
        {Math.round(pct)}%
      </span>
    </div>
  );
}
