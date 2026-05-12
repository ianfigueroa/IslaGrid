"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  CloudRain,
  Droplets,
  Factory,
  Flame,
  Globe2,
  Info,
  Layers,
  Map as MapIcon,
  MessageSquareWarning,
  Sun,
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
  | "demand"
  | "rain-radar"
  | "wind";

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
  { key: "municipalities", label: "Municipalities", hint: "Borders + status fill",      Icon: Layers,               available: true,  group: "grid" },
  { key: "grid-now",       label: "Grid status",    hint: "Demand · reserves · gen",    Icon: Activity,             available: true,  group: "grid" },
  { key: "generation",     label: "Power plants",   hint: "Output by fuel type",        Icon: Zap,                  available: true,  group: "grid" },
  { key: "infrastructure", label: "Lines + subs",   hint: "OSM-mapped infrastructure",  Icon: Factory,              available: true,  group: "grid" },
  { key: "planned-work",   label: "Planned work",   hint: "LUMA scheduled outages",     Icon: Wrench,               available: true,  group: "grid" },
  { key: "outage-risk",    label: "Outage risk",    hint: "Model-predicted by muni",    Icon: TriangleAlert,        available: true,  group: "grid" },
  { key: "outages-live",   label: "Live outages",   hint: "Last 24h events",            Icon: Flame,                available: true,  group: "grid" },
  { key: "demand",         label: "Demand est.",    hint: "Experimental pressure",      Icon: Wind,                 available: true,  group: "grid" },
  // Weather — animated overlays (Windy-style)
  { key: "rain-radar",     label: "Rain radar",     hint: "Live precipitation",         Icon: Droplets,             available: true,  group: "weather" },
  { key: "wind",           label: "Wind",           hint: "Animated streamlines",       Icon: Wind,                 available: true,  group: "weather" },
  { key: "weather-alerts", label: "NWS alerts",     hint: "Active PR warnings",         Icon: CloudRain,            available: true,  group: "weather" },
  { key: "hurricane",      label: "Hurricane cone", hint: "NHC active advisories",      Icon: Globe2,               available: true,  group: "weather" },
  { key: "quakes",         label: "Earthquakes",    hint: "USGS · 7d · M ≥ 2.5",        Icon: Waves,                available: true,  group: "weather" },
  // Community
  { key: "reports",        label: "Community",      hint: "Anonymous reports (H3)",     Icon: MessageSquareWarning, available: true,  group: "community" },
  // Solar
  { key: "solar",          label: "Solar lens",     hint: "Rooftop heatmap (soon)",     Icon: Sun,                  available: false, group: "solar" },
];

// Map presets — chosen layer sets for common scenarios. The map state
// remains user-editable after a preset is applied; presets just stage it.
type PresetKey = "default" | "storm" | "solar" | "reporter";

const PRESETS: Record<PresetKey, { label: string; layers: LayerKey[]; Icon: typeof MapIcon }> = {
  default: {
    label: "Default",
    layers: ["municipalities", "grid-now", "generation"],
    Icon: Layers,
  },
  storm: {
    label: "Storm",
    layers: [
      "municipalities",
      "rain-radar",
      "wind",
      "weather-alerts",
      "hurricane",
      "outage-risk",
      "outages-live",
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
  // Default open on first visit — the rail is the primary interaction surface.
  const [open, setOpen] = useState(true);
  const railRef = useRef<HTMLElement>(null);

  useEffect(() => {
    try {
      const v = localStorage.getItem(RAIL_KEY);
      // Honor an explicit pin (open or closed); otherwise default to open on
      // desktop, collapsed on small screens to keep the map breathable.
      if (v === "0") setOpen(false);
      else if (v === "1") setOpen(true);
      else setOpen(window.innerWidth >= 768);
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
        "pointer-events-auto absolute left-3 z-20 flex flex-col rounded-2xl glass-strong transition-[width,height] duration-200 ease-out",
        // Sits below status hero on desktop, separate on mobile
        "top-[16rem] sm:top-[15.5rem] bottom-3",
        open ? "w-72" : "w-14",
      )}
    >
      <button
        type="button"
        onClick={() => setPinned(!open)}
        aria-label={open ? "Collapse layer panel" : "Expand layer panel"}
        aria-expanded={open}
        className="flex h-12 cursor-pointer items-center gap-2 border-b border-line px-3.5 text-text-2 transition-colors hover:text-text"
      >
        <Layers className="size-4 shrink-0" aria-hidden />
        <span
          className={cn(
            "flex-1 text-left text-[11px] font-semibold uppercase tracking-[0.18em] transition-opacity",
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
          <ChevronRight className="absolute right-2 size-3.5 text-text-3" aria-hidden />
        ) : null}
      </button>

      {open ? (
        <div className="border-b border-line p-2.5">
          <p className="px-1 pb-2 text-[10px] uppercase tracking-[0.18em] text-text-3">
            Presets
          </p>
          <div className="grid grid-cols-4 gap-1.5">
            {(Object.keys(PRESETS) as PresetKey[]).map((p) => {
              const { label, Icon } = PRESETS[p];
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => applyPreset(p)}
                  className="group flex flex-col items-center gap-1 rounded-lg border border-line bg-surface px-1 py-2 text-[11px] text-text-2 transition-all hover:border-brand hover:bg-brand-soft hover:text-brand"
                  aria-label={`Apply ${label} preset`}
                >
                  <Icon className="size-4" aria-hidden />
                  <span className="font-medium">{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2.5">
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
                <p className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-3">
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
                      "group relative flex items-center gap-3 rounded-xl px-2 py-2 text-sm transition-all",
                      available ? "cursor-pointer" : "cursor-not-allowed opacity-40",
                      isActive
                        ? "bg-brand-soft text-brand-strong shadow-[inset_0_0_0_1px_var(--color-brand)]"
                        : "text-text-2 hover:bg-surface-2 hover:text-text",
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-8 shrink-0 place-items-center rounded-lg transition-colors",
                        isActive
                          ? "bg-brand text-white"
                          : "bg-surface-2 text-text-2 group-hover:bg-surface-3",
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
                      <span className="truncate text-[11px] leading-tight text-text-3">
                        {hint}
                      </span>
                    </span>
                    {open && !available ? (
                      <span className="ml-auto rounded-md bg-surface-3 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-text-3">
                        soon
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {open ? (
        <a
          href="/attribution"
          className="flex items-center gap-2 border-t border-line px-3 py-2.5 text-[11px] text-text-3 transition-colors hover:bg-surface-2 hover:text-text-2"
        >
          <Info className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">Sources &amp; attribution</span>
        </a>
      ) : null}
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
