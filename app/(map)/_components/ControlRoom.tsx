"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import type { GridSnapshot } from "@/lib/supabase";
import { isAutoTheme, suggestAutoTheme, useTheme } from "@/lib/theme";
import { StatusBar } from "./StatusBar";
import { TopNav } from "./TopNav";
import { LayerRail, useLayerUrlState, type LayerKey } from "./LayerRail";
import { IntelligencePanel, type PanelSelection } from "./IntelligencePanel";
import { UpdateTimeline, type UpdateItem } from "./UpdateTimeline";
import { EmptyStateNote } from "./EmptyStateNote";
import { GridStatusDetails } from "./GridStatusDetails";
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

  // Auto-theme: dark during night hours OR when a hurricane advisory is
  // active. Only runs when the user hasn't explicitly pinned a theme
  // (isAutoTheme()=true) — preserves user choice when they set it manually.
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
        /* no signal; fall through to time-based */
      }
      if (cancelled) return;
      setTheme(suggestAutoTheme({ hurricaneActive }));
    }
    void pick();
    // Re-evaluate hourly so it flips at 22:00 / 06:00 boundaries.
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

  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const res = await fetch("/api/grid/status", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { snapshot: GridSnapshot | null };
        if (json.snapshot) setSnapshot(json.snapshot);
      } catch {
        /* keep prior snapshot */
      }
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  const setLayers = useCallback((next: Set<LayerKey>) => {
    setActiveLayers(next);
  }, []);

  useLayerUrlState(activeLayers, setLayers);

  // GridMap only acts on the subset it knows about.
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
      <TopNav />
      <StatusBar
        snapshot={snapshot}
        onStatusClick={() =>
          snapshot &&
          setSelection({
            kind: "municipality",
            id: `grid:${snapshot.ts}`,
            title: "Puerto Rico grid status",
            subtitle: `${snapshot.status.toUpperCase()} · as of ${new Date(snapshot.ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`,
            body: <GridStatusDetails snapshot={snapshot} />,
          })
        }
      />
      <EmptyStateNote visible={snapshot == null} />
      <LayerRail active={activeLayers} onSetActive={setLayers} />
      <IntelligencePanel selection={selection} onClose={() => setSelection(null)} />
      <UpdateTimeline items={updates} />
      <ReportSheet enabled={activeLayers.has("reports")} />
      <MapErrorBanner message={mapError} onDismiss={() => setMapError(null)} />
    </main>
  );
}
