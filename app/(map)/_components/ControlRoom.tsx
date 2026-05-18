"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import type { GridSnapshot } from "@/lib/supabase";
import { useTheme } from "@/lib/theme";
import { BrandPill } from "./BrandPill";
import { GridStatusButton } from "./GridStatusButton";
import { StatusPanel } from "./StatusPanel";
import { LayerPills } from "./LayerPills";
import { MapLegend } from "./MapLegend";
import { useLayerUrlState, type LayerKey } from "./LayerRail";
import { IntelligencePanel, type PanelSelection } from "./IntelligencePanel";
import type { UpdateItem } from "./UpdateTimeline";
import { EmptyStateNote } from "./EmptyStateNote";
import { MunicipalitySummary } from "./MunicipalitySummary";
import { PlantSummary } from "./PlantSummary";
import { MapErrorBanner } from "./MapErrorBanner";
import { ReportSheet } from "./ReportSheet";
import { EmptyLayerToast } from "./EmptyLayerToast";
import { OutagesPanel } from "./OutagesPanel";
import { OutagesButton } from "./OutagesButton";
import { OutageBanner } from "./OutageBanner";
import type { ActiveLayerKey, Basemap } from "./GridMap";

const GridMap = dynamic(() => import("./GridMap").then((m) => m.GridMap), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center text-text-3 text-sm">
      Loading map…
    </div>
  ),
});

interface Props {
  initialSnapshot: GridSnapshot | null;
  initialUpdates: UpdateItem[];
}

export function ControlRoom({ initialSnapshot, initialUpdates }: Props) {
  const { theme, setTheme } = useTheme();

  // No auto-theme. Light by default; the toggle in the brand menu is the only
  // way to switch. (We used to flip back to dark every night based on local
  // time, which kept "fighting" the user when they pinned light and came back
  // to the map from /bill or /solar.)

  const [snapshot, setSnapshot] = useState<GridSnapshot | null>(initialSnapshot);
  const [updates] = useState<UpdateItem[]>(initialUpdates);
  // Basemap and UI theme are coupled by default — picking a dark basemap
  // from the drawer also flips the chrome to dark so the floating pills
  // don't look out of place. Satellite leaves the UI theme untouched (the
  // user explicitly picked imagery; their theme choice still stands).
  const [basemap, setBasemap] = useState<Basemap>(() => (theme === "dark" ? "dark" : "light"));
  useEffect(() => {
    setBasemap((prev) => (prev === "satellite" ? "satellite" : theme === "dark" ? "dark" : "light"));
  }, [theme]);
  const handleBasemapChange = useCallback(
    (next: Basemap) => {
      setBasemap(next);
      if (next === "dark" && theme !== "dark") setTheme("dark");
      else if (next === "light" && theme !== "light") setTheme("light");
      // "satellite" is theme-agnostic — leave UI theme alone.
    },
    [theme, setTheme],
  );
  const [activeLayers, setActiveLayers] = useState<Set<LayerKey>>(
    () =>
      new Set<LayerKey>([
        "municipalities",
        "grid-now",
        "generation",
      ]),
  );
  const [selection, setSelection] = useState<PanelSelection | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [outagesOpen, setOutagesOpen] = useState(false);
  const [emptyLayerNote, setEmptyLayerNote] = useState<string | null>(null);
  // Tracks which layers we've already probed-when-empty since the user opened
  // the session. Without this, every render of an empty layer would re-toast.
  const [probedEmpty, setProbedEmpty] = useState<Set<LayerKey>>(new Set());

  // Tag the body so global CSS can lock scroll on the map route only.
  // Subpages (bill, solar, battery, disaster) need to scroll normally.
  useEffect(() => {
    document.body.dataset.route = "map";
    return () => {
      delete document.body.dataset.route;
    };
  }, []);

  // Refresh the snapshot every 30s so the status pill stays current. The
  // upstream ingest tops out at ~5 min, so polling faster doesn't buy
  // freshness — 30s just shortens the worst-case stale window the user sees.
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const res = await fetch("/api/grid/status", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { snapshot: GridSnapshot | null };
        if (json.snapshot) setSnapshot(json.snapshot);
      } catch {
        /* keep prior */
      }
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  const setLayers = useCallback((next: Set<LayerKey>) => {
    setActiveLayers(next);
  }, []);

  // Probe layers that often render empty (no active storm in the Atlantic
  // basin, no recent quakes) so the user knows the toggle worked. We only
  // probe each layer once per session — if the user toggles off + on we don't
  // nag them again.
  useEffect(() => {
    type Probe = {
      key: LayerKey;
      url: string;
      message: string;
      isEmpty: (json: unknown) => boolean;
    };
    const probes: Probe[] = [
      {
        key: "hurricane",
        url: "/api/hurricanes/active",
        message: "No active storms in the Atlantic basin right now.",
        isEmpty: (j) =>
          !!j &&
          typeof j === "object" &&
          Array.isArray((j as { features?: unknown[] }).features) &&
          (j as { features: unknown[] }).features.length === 0,
      },
    ];
    for (const probe of probes) {
      if (!activeLayers.has(probe.key)) continue;
      if (probedEmpty.has(probe.key)) continue;
      // Mark as probed eagerly so concurrent re-renders don't refire.
      setProbedEmpty((prev) => {
        const next = new Set(prev);
        next.add(probe.key);
        return next;
      });
      void (async () => {
        try {
          const res = await fetch(probe.url, { cache: "no-store" });
          if (!res.ok) return;
          const json: unknown = await res.json();
          if (probe.isEmpty(json)) setEmptyLayerNote(probe.message);
        } catch {
          /* network error already surfaces via the map layer's own handler */
        }
      })();
    }
  }, [activeLayers, probedEmpty]);

  useLayerUrlState(activeLayers, setLayers);

  // GridMap only knows about a subset of the rail's layer keys.
  const mapLayers = new Set<ActiveLayerKey>(
    Array.from(activeLayers).filter((k): k is ActiveLayerKey =>
      [
        "municipalities",
        "grid-now",
        "generation",
        "infrastructure",
        "planned-work",
        "outage-risk",
        "reports",
        "demand",
        "outages-live",
        "weather-alerts",
        "hurricane",
        "quakes",
      ].includes(k),
    ),
  );

  return (
    <main className="relative h-dvh w-dvw overflow-hidden bg-bg">
      <GridMap
        theme={theme}
        basemap={basemap}
        activeLayers={mapLayers}
        onMapError={(msg) => setMapError(msg)}
        onSelectMunicipality={(id, name) =>
          setSelection({
            kind: "municipality",
            id,
            title: name,
            subtitle: "MUNICIPALITY",
            body: <MunicipalitySummary municipalityId={id} />,
          })
        }
        onSelectPlant={(id, title, fuel, capacityMw) =>
          setSelection({
            kind: "plant",
            id,
            title,
            subtitle: fuel ? `Fuel: ${fuel}` : "Power plant",
            body: (
              <PlantSummary
                plantId={id}
                fallbackName={title}
                fallbackFuel={fuel}
                fallbackCapacityMw={capacityMw ?? null}
              />
            ),
          })
        }
      />

      <OutageBanner />
      <BrandPill basemap={basemap} onBasemapChange={handleBasemapChange} />
      <GridStatusButton
        snapshot={snapshot}
        active={panelOpen}
        onClick={() => {
          setPanelOpen((v) => !v);
          if (outagesOpen) setOutagesOpen(false);
        }}
      />
      <OutagesButton
        active={outagesOpen}
        onClick={() => {
          setOutagesOpen((v) => !v);
          if (panelOpen) setPanelOpen(false);
        }}
      />
      <StatusPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        snapshot={snapshot}
        updates={updates}
      />
      <OutagesPanel
        open={outagesOpen}
        onClose={() => setOutagesOpen(false)}
      />
      <LayerPills active={activeLayers} onSetActive={setLayers} />
      <MapLegend active={activeLayers} />

      <EmptyStateNote visible={snapshot == null} />
      <IntelligencePanel selection={selection} onClose={() => setSelection(null)} />
      <ReportSheet />
      <EmptyLayerToast
        message={emptyLayerNote}
        onDismiss={() => setEmptyLayerNote(null)}
      />
      <MapErrorBanner message={mapError} onDismiss={() => setMapError(null)} />
    </main>
  );
}
