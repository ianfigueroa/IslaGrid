"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import type { GridSnapshot } from "@/lib/supabase";
import { isAutoTheme, suggestAutoTheme, useTheme } from "@/lib/theme";
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
import { MapErrorBanner } from "./MapErrorBanner";
import { ReportSheet } from "./ReportSheet";
import type { ActiveLayerKey } from "./GridMap";

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

  // Auto-theme: dark at night OR during hurricane advisories. Honors a pinned
  // user choice via isAutoTheme().
  useEffect(() => {
    if (!isAutoTheme()) return;
    let cancelled = false;
    async function pick() {
      let hurricaneActive = false;
      try {
        const res = await fetch("/api/hurricanes/active", { cache: "no-store" });
        if (res.ok) {
          const json = (await res.json()) as { features?: unknown[] };
          hurricaneActive = (json.features?.length ?? 0) > 0;
        }
      } catch {
        /* fall through to time-based */
      }
      if (cancelled) return;
      setTheme(suggestAutoTheme({ hurricaneActive }));
    }
    void pick();
    const t = setInterval(pick, 60 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [setTheme]);

  const [snapshot, setSnapshot] = useState<GridSnapshot | null>(initialSnapshot);
  const [updates] = useState<UpdateItem[]>(initialUpdates);
  const [activeLayers, setActiveLayers] = useState<Set<LayerKey>>(
    () =>
      new Set<LayerKey>([
        "municipalities",
        "grid-now",
        "generation",
        "rain-radar",
      ]),
  );
  const [selection, setSelection] = useState<PanelSelection | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  // Tag the body so global CSS can lock scroll on the map route only.
  // Subpages (bill, solar, battery, disaster) need to scroll normally.
  useEffect(() => {
    document.body.dataset.route = "map";
    return () => {
      delete document.body.dataset.route;
    };
  }, []);

  // Refresh the snapshot once a minute so the status pill stays current.
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
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  const setLayers = useCallback((next: Set<LayerKey>) => {
    setActiveLayers(next);
  }, []);

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
        "rain-radar",
        "wind",
      ].includes(k),
    ),
  );

  return (
    <main className="relative h-dvh w-dvw overflow-hidden bg-bg">
      <GridMap
        theme={theme}
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
        onSelectPlant={(id, title, fuel) =>
          setSelection({
            kind: "plant",
            id,
            title,
            subtitle: fuel ? `Fuel: ${fuel}` : "Power plant",
            body: (
              <p className="text-xs text-text-3">
                Source: OpenStreetMap (community-mapped). Not utility-grade.
                <br />
                Live output (where available) joins from datos.pr.gov; refresh
                in 5 min cycles.
              </p>
            ),
          })
        }
      />

      <BrandPill />
      <GridStatusButton
        snapshot={snapshot}
        active={panelOpen}
        onClick={() => setPanelOpen((v) => !v)}
      />
      <StatusPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        snapshot={snapshot}
        updates={updates}
      />
      <LayerPills active={activeLayers} onSetActive={setLayers} />
      <MapLegend active={activeLayers} />

      <EmptyStateNote visible={snapshot == null} />
      <IntelligencePanel selection={selection} onClose={() => setSelection(null)} />
      <ReportSheet />
      <MapErrorBanner message={mapError} onDismiss={() => setMapError(null)} />
    </main>
  );
}
