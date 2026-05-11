"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  CloudRain,
  Factory,
  Info,
  Layers,
  Map as MapIcon,
  MessageSquareWarning,
  Sun,
  TriangleAlert,
  Wrench,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/cn";

export type LayerKey =
  | "municipalities"
  | "grid-now"
  | "generation"
  | "infrastructure"
  | "outage-risk"
  | "planned-work"
  | "reports"
  | "weather"
  | "solar";

interface LayerDef {
  key: LayerKey;
  label: string;
  hint: string;
  Icon: typeof MapIcon;
  available: boolean;
}

const LAYERS: LayerDef[] = [
  { key: "municipalities", label: "Municipalities", hint: "Status by region",           Icon: Layers,               available: true  },
  { key: "grid-now",       label: "Grid now",       hint: "Live demand & reserves",     Icon: Activity,             available: true  },
  { key: "generation",     label: "Generation",     hint: "Plant output by fuel",       Icon: Zap,                  available: true  },
  { key: "infrastructure", label: "Infrastructure", hint: "Substations & plants (OSM)", Icon: Factory,              available: true  },
  { key: "planned-work",   label: "Planned work",   hint: "LUMA scheduled outages",     Icon: Wrench,               available: true  },
  { key: "outage-risk",    label: "Outage risk",    hint: "Coming with weather feed",   Icon: TriangleAlert,        available: false },
  { key: "reports",        label: "Community",      hint: "Community-submitted reports",Icon: MessageSquareWarning, available: false },
  { key: "weather",        label: "Weather",        hint: "NWS PR alerts",              Icon: CloudRain,            available: false },
  { key: "solar",          label: "Solar lens",     hint: "Rooftop potential",          Icon: Sun,                  available: false },
];

interface Props {
  active: Set<LayerKey>;
  onToggle: (key: LayerKey) => void;
}

const RAIL_KEY = "islagrid-rail-open";

export function LayerRail({ active, onToggle }: Props) {
  const [open, setOpen] = useState(false);
  const railRef = useRef<HTMLElement>(null);

  // Restore pinned state
  useEffect(() => {
    try {
      const v = localStorage.getItem(RAIL_KEY);
      if (v === "1") setOpen(true);
    } catch { /* ignore */ }
  }, []);

  const setPinned = (next: boolean) => {
    setOpen(next);
    try { localStorage.setItem(RAIL_KEY, next ? "1" : "0"); } catch { /* ignore */ }
  };

  // Outside click closes the rail when open
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!railRef.current) return;
      if (!railRef.current.contains(e.target as Node)) {
        // Don't auto-close on outside click — user explicitly pinned it.
        // But if they tap the map on mobile, close. Use 768px breakpoint.
        if (window.innerWidth < 768) setPinned(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <nav
      ref={railRef}
      aria-label="Map layers"
      className={cn(
        "surface pointer-events-auto absolute left-3 top-[4.5rem] bottom-14 z-20 flex flex-col rounded-xl transition-[width] duration-200 ease-out",
        open ? "w-60" : "w-12",
      )}
    >
      <button
        type="button"
        onClick={() => setPinned(!open)}
        aria-label={open ? "Collapse layer panel" : "Expand layer panel"}
        aria-expanded={open}
        className="flex h-10 cursor-pointer items-center gap-2 border-b border-line px-3 text-text-2 transition-colors hover:text-text"
      >
        <Layers className="size-4 shrink-0" aria-hidden />
        <span
          className={cn(
            "flex-1 text-left text-[11px] font-medium uppercase tracking-[0.14em] transition-opacity",
            open ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          Layers
        </span>
        <span className={cn("transition-opacity", open ? "opacity-100" : "pointer-events-none opacity-0")}>
          <ChevronLeft className="size-4" aria-hidden />
        </span>
        {!open ? (
          <ChevronRight className="absolute right-1.5 size-3 text-text-3" aria-hidden />
        ) : null}
      </button>

      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-1.5">
        {LAYERS.map(({ key, label, hint, Icon, available }) => {
          const isActive = active.has(key);
          return (
            <button
              key={key}
              type="button"
              disabled={!available}
              aria-pressed={isActive}
              aria-label={`${label}${isActive ? " (active)" : ""}${!available ? " (coming soon)" : ""}`}
              onClick={() => available && onToggle(key)}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors",
                available ? "cursor-pointer" : "cursor-not-allowed opacity-40",
                isActive
                  ? "bg-surface-2 text-text"
                  : "text-text-2 hover:bg-surface-2 hover:text-text",
              )}
            >
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-md border transition-colors",
                  isActive
                    ? "border-brand/40 bg-brand-soft text-brand"
                    : "border-line text-text-2 group-hover:border-line-2",
                )}
              >
                <Icon className="size-4" aria-hidden />
              </span>
              <span
                className={cn(
                  "flex min-w-0 flex-col items-start text-left transition-opacity",
                  open ? "opacity-100" : "pointer-events-none opacity-0",
                )}
              >
                <span className="font-medium leading-tight">{label}</span>
                <span className="truncate text-[10px] leading-tight text-text-3">{hint}</span>
              </span>
              {open && !available ? (
                <span className="ml-auto rounded-md border border-line bg-surface-3 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-text-3">
                  soon
                </span>
              ) : null}
              {open && available ? (
                <span
                  aria-hidden
                  className={cn(
                    "ml-auto size-2 rounded-full transition-colors",
                    isActive ? "bg-brand" : "bg-line-2",
                  )}
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="border-t border-line p-2">
        <a
          href="/attribution"
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-text-3 transition-colors hover:bg-surface-2 hover:text-text-2",
          )}
        >
          <Info className="size-3.5 shrink-0" aria-hidden />
          <span
            className={cn(
              "truncate transition-opacity",
              open ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            Sources &amp; attribution
          </span>
        </a>
      </div>
    </nav>
  );
}
