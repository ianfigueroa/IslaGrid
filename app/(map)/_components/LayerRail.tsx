"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  BatteryCharging,
  Calculator,
  ChevronLeft,
  ChevronRight,
  CloudRain,
  Factory,
  Flame,
  Globe2,
  Info,
  Layers,
  LifeBuoy,
  Map as MapIcon,
  MessageSquareWarning,
  Sun,
  Sunrise,
  TriangleAlert,
  Waves,
  Wind,
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
  | "outages-live"
  | "weather-alerts"
  | "hurricane"
  | "quakes"
  | "solar"
  | "demand";

interface LayerDef {
  key: LayerKey;
  label: string;
  hint: string;
  Icon: typeof MapIcon;
  available: boolean;
  group: "grid" | "weather" | "community" | "solar";
}

const LAYERS: LayerDef[] = [
  // Grid
  { key: "municipalities", label: "Municipalities", hint: "Status by region",            Icon: Layers,               available: true,  group: "grid" },
  { key: "grid-now",       label: "Grid now",       hint: "Live demand & reserves",      Icon: Activity,             available: true,  group: "grid" },
  { key: "generation",     label: "Generation",     hint: "Plant output by fuel",        Icon: Zap,                  available: true,  group: "grid" },
  { key: "infrastructure", label: "Infrastructure", hint: "Substations & plants (OSM)",  Icon: Factory,              available: true,  group: "grid" },
  { key: "planned-work",   label: "Planned work",   hint: "LUMA scheduled outages",      Icon: Wrench,               available: true,  group: "grid" },
  { key: "outage-risk",    label: "Outage risk",    hint: "Weather + grid + hurricane",  Icon: TriangleAlert,        available: true,  group: "grid" },
  { key: "outages-live",   label: "Active outages", hint: "Last 24h LUMA events",        Icon: Flame,                available: true,  group: "grid" },
  { key: "demand",         label: "Demand (est.)",  hint: "Experimental pressure proxy", Icon: Wind,                 available: true,  group: "grid" },
  // Weather
  { key: "weather-alerts", label: "NWS alerts",     hint: "Live PR weather alerts",      Icon: CloudRain,            available: true,  group: "weather" },
  { key: "hurricane",      label: "Hurricane cone", hint: "NHC active advisories",       Icon: Globe2,               available: true,  group: "weather" },
  { key: "quakes",         label: "Earthquakes",    hint: "USGS, last 7 days, M ≥ 2.5",  Icon: Waves,                available: true,  group: "weather" },
  // Community
  { key: "reports",        label: "Community",      hint: "Anonymous reports (H3)",      Icon: MessageSquareWarning, available: true,  group: "community" },
  // Solar (still gated on NREL PVRDB ingest)
  { key: "solar",          label: "Solar lens",     hint: "Rooftop heatmap (soon)",      Icon: Sun,                  available: false, group: "solar" },
];

// Map presets — chosen layer sets for common scenarios. The map state
// remains user-editable after a preset is applied; presets just stage it.
type PresetKey = "default" | "storm" | "solar" | "reporter";

const PRESETS: Record<PresetKey, { label: string; layers: LayerKey[]; Icon: typeof MapIcon }> = {
  default: {
    label: "Default",
    layers: ["municipalities", "grid-now", "generation", "infrastructure"],
    Icon: Layers,
  },
  storm: {
    label: "Storm",
    layers: [
      "municipalities",
      "outage-risk",
      "outages-live",
      "weather-alerts",
      "hurricane",
      "planned-work",
    ],
    Icon: AlertTriangle,
  },
  solar: {
    label: "Solar",
    layers: ["municipalities", "solar", "generation"],
    Icon: Sun,
  },
  reporter: {
    label: "Reporter",
    layers: ["municipalities", "reports", "weather-alerts", "outages-live"],
    Icon: MessageSquareWarning,
  },
};

interface Props {
  active: Set<LayerKey>;
  onSetActive: (layers: Set<LayerKey>) => void;
}

const RAIL_KEY = "islagrid-rail-open";

export function LayerRail({ active, onSetActive }: Props) {
  const [open, setOpen] = useState(false);
  const railRef = useRef<HTMLElement>(null);

  useEffect(() => {
    try {
      const v = localStorage.getItem(RAIL_KEY);
      if (v === "1") setOpen(true);
    } catch {
      /* ignore */
    }
  }, []);

  const setPinned = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(RAIL_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!railRef.current) return;
      if (!railRef.current.contains(e.target as Node)) {
        if (window.innerWidth < 768) setPinned(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const toggle = useCallback(
    (key: LayerKey) => {
      const next = new Set(active);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      onSetActive(next);
    },
    [active, onSetActive],
  );

  const applyPreset = useCallback(
    (preset: PresetKey) => {
      onSetActive(new Set(PRESETS[preset].layers));
    },
    [onSetActive],
  );

  const groupedLayers = useMemo(() => {
    const groups: Record<LayerDef["group"], LayerDef[]> = {
      grid: [],
      weather: [],
      community: [],
      solar: [],
    };
    for (const l of LAYERS) groups[l.group].push(l);
    return groups;
  }, []);

  return (
    <nav
      ref={railRef}
      aria-label="Map layers"
      className={cn(
        "surface pointer-events-auto absolute left-3 top-[4.5rem] bottom-14 z-20 flex flex-col rounded-xl transition-[width] duration-200 ease-out",
        open ? "w-64" : "w-12",
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
        <span
          className={cn(
            "transition-opacity",
            open ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          <ChevronLeft className="size-4" aria-hidden />
        </span>
        {!open ? (
          <ChevronRight className="absolute right-1.5 size-3 text-text-3" aria-hidden />
        ) : null}
      </button>

      {open ? (
        <div className="border-b border-line p-2">
          <p className="px-1 pb-1.5 text-[10px] uppercase tracking-[0.14em] text-text-3">
            Presets
          </p>
          <div className="grid grid-cols-4 gap-1">
            {(Object.keys(PRESETS) as PresetKey[]).map((p) => {
              const { label, Icon } = PRESETS[p];
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => applyPreset(p)}
                  className="group flex flex-col items-center gap-1 rounded-md border border-line bg-surface-2 px-1 py-1.5 text-[10px] text-text-2 transition-colors hover:border-line-2 hover:text-text"
                  aria-label={`Apply ${label} preset`}
                >
                  <Icon className="size-3.5" aria-hidden />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-1.5">
        {(["grid", "weather", "community", "solar"] as const).map((group) => {
          const items = groupedLayers[group];
          if (items.length === 0) return null;
          const labels: Record<typeof group, string> = {
            grid: "Grid",
            weather: "Weather",
            community: "Community",
            solar: "Solar",
          };
          return (
            <div key={group} className="flex flex-col gap-0.5">
              {open ? (
                <p className="px-2 pt-1 text-[9px] uppercase tracking-[0.14em] text-text-3">
                  {labels[group]}
                </p>
              ) : null}
              {items.map(({ key, label, hint, Icon, available }) => {
                const isActive = active.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={!available}
                    aria-pressed={isActive}
                    aria-label={`${label}${isActive ? " (active)" : ""}${!available ? " (coming soon)" : ""}`}
                    onClick={() => available && toggle(key)}
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
                      <span className="truncate text-[10px] leading-tight text-text-3">
                        {hint}
                      </span>
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
          );
        })}
      </div>

      <div className="border-t border-line p-2 space-y-0.5">
        <a
          href="/bill"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
        >
          <Calculator className="size-3.5 shrink-0" aria-hidden />
          <span
            className={cn(
              "truncate transition-opacity",
              open ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            What&rsquo;s my bill?
          </span>
        </a>
        <a
          href="/solar"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
        >
          <Sunrise className="size-3.5 shrink-0" aria-hidden />
          <span
            className={cn(
              "truncate transition-opacity",
              open ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            Is solar worth it?
          </span>
        </a>
        <a
          href="/battery"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
        >
          <BatteryCharging className="size-3.5 shrink-0" aria-hidden />
          <span
            className={cn(
              "truncate transition-opacity",
              open ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            Battery sizing
          </span>
        </a>
        <a
          href="/disaster"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-warn transition-colors hover:bg-surface-2"
        >
          <LifeBuoy className="size-3.5 shrink-0" aria-hidden />
          <span
            className={cn(
              "truncate transition-opacity",
              open ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            Disaster mode
          </span>
        </a>
        <a
          href="/attribution"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-text-3 transition-colors hover:bg-surface-2 hover:text-text-2"
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

/**
 * Sync helpers — encode/decode the active-layer set as a single URL hash
 * parameter so map state is shareable.
 */
export function encodeLayers(active: Set<LayerKey>): string {
  return Array.from(active).sort().join(",");
}

export function decodeLayers(raw: string | null): Set<LayerKey> | null {
  if (!raw) return null;
  const known = new Set<LayerKey>(LAYERS.map((l) => l.key));
  const parsed = new Set<LayerKey>();
  for (const part of raw.split(",")) {
    const trimmed = part.trim() as LayerKey;
    if (known.has(trimmed)) parsed.add(trimmed);
  }
  return parsed.size > 0 ? parsed : null;
}

export function useLayerUrlState(
  active: Set<LayerKey>,
  setActive: (next: Set<LayerKey>) => void,
): void {
  const router = useRouter();
  const params = useSearchParams();
  const initRef = useRef(false);

  // Read from URL on first mount.
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const decoded = decodeLayers(params.get("layers"));
    if (decoded) setActive(decoded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Write to URL when set changes.
  useEffect(() => {
    if (!initRef.current) return;
    const encoded = encodeLayers(active);
    const url = new URL(window.location.href);
    if (encoded) url.searchParams.set("layers", encoded);
    else url.searchParams.delete("layers");
    // Cast: this is a same-origin URL we constructed from window.location;
    // Next's typed-routes view doesn't know about runtime URLs.
    router.replace(
      `${url.pathname}${url.search}` as unknown as Parameters<typeof router.replace>[0],
      { scroll: false },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
