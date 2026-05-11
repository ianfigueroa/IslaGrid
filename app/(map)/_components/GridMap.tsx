"use client";

import { useEffect, useRef } from "react";
import maplibregl, { Map as MlMap } from "maplibre-gl";

const BASEMAP_DARK = "https://cartodb-basemaps-{a-d}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png";
const BASEMAP_LIGHT = "https://cartodb-basemaps-{a-d}.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png";

function tileUrls(template: string) {
  return ["a", "b", "c", "d"].map((s) => template.replace("{a-d}", s));
}

function buildStyle(theme: "dark" | "light"): maplibregl.StyleSpecification {
  const tpl = theme === "dark" ? BASEMAP_DARK : BASEMAP_LIGHT;
  return {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles: tileUrls(tpl),
        tileSize: 256,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>',
      },
    },
    glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
    layers: [
      {
        id: "basemap",
        type: "raster",
        source: "basemap",
        paint: { "raster-saturation": theme === "dark" ? -0.3 : -0.05 },
      },
    ],
  };
}

// Soft, warm fuel palette — no AI-tech cyan
const FUEL_COLOR: Record<string, string> = {
  oil: "#c2865a",
  diesel: "#c2865a",
  gas: "#d97706",
  coal: "#6b7280",
  solar: "#f5b942",
  wind: "#94a3b8",
  hydro: "#38bdf8",
  landfill: "#84cc16",
  battery: "#2dd4bf",
  unknown: "#525252",
};

// Per-municipality status fill, theme-aware via getComputedStyle later
const STATUS_FILL: Record<string, string> = {
  normal: "#10b981",
  watch: "#f59e0b",
  strained: "#f97316",
  critical: "#ef4444",
  stale: "#737373",
  unknown: "#525252",
};

export type ActiveLayerKey =
  | "municipalities"
  | "grid-now"
  | "generation"
  | "infrastructure"
  | "planned-work";

interface Props {
  onSelectMunicipality?: (id: string, name: string) => void;
  onSelectPlant?: (id: string, name: string, fuel?: string) => void;
  activeLayers: Set<ActiveLayerKey>;
  theme: "dark" | "light";
}

export function GridMap({
  onSelectMunicipality,
  onSelectPlant,
  activeLayers,
  theme,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const themeRef = useRef(theme);
  const onSelMuniRef = useRef(onSelectMunicipality);
  const onSelPlantRef = useRef(onSelectPlant);

  themeRef.current = theme;
  onSelMuniRef.current = onSelectMunicipality;
  onSelPlantRef.current = onSelectPlant;

  // One-time map setup
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildStyle(theme),
      center: [-66.5, 18.23],
      zoom: 8.4,
      minZoom: 7,
      maxZoom: 14,
      maxBounds: [
        [-68.5, 17.0],
        [-64.0, 19.5],
      ],
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

    map.on("load", () => {
      addDataLayers(map);
      applyLayerVisibility(map);
    });

    map.on("click", "municipalities-fill", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties as { id: string; name: string };
      onSelMuniRef.current?.(p.id, p.name);
    });

    map.on("mouseenter", "municipalities-fill", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "municipalities-fill", () => {
      map.getCanvas().style.cursor = "";
    });

    mapRef.current = map;

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);
    requestAnimationFrame(() => map.resize());

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme swap — rebuild basemap source without losing data layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const tpl = theme === "dark" ? BASEMAP_DARK : BASEMAP_LIGHT;
    const src = map.getSource("basemap") as maplibregl.RasterTileSource | undefined;
    if (src) {
      src.setTiles(tileUrls(tpl));
      map.setPaintProperty("basemap", "raster-saturation", theme === "dark" ? -0.3 : -0.05);
    }
    // Re-color municipality stroke for light mode contrast
    if (map.getLayer("municipalities-outline")) {
      map.setPaintProperty(
        "municipalities-outline",
        "line-color",
        theme === "dark" ? "#1c1c1c" : "#fafaf9",
      );
    }
    if (map.getLayer("osm-plants")) {
      map.setPaintProperty(
        "osm-plants",
        "circle-stroke-color",
        theme === "dark" ? "#0a0a0a" : "#ffffff",
      );
    }
    if (map.getLayer("osm-substations")) {
      map.setPaintProperty(
        "osm-substations",
        "circle-stroke-color",
        theme === "dark" ? "#0a0a0a" : "#ffffff",
      );
    }
  }, [theme]);

  // Active-layer changes -> visibility flips
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    applyLayerVisibility(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Array.from(activeLayers).sort().join(",")]);

  function applyLayerVisibility(map: MlMap) {
    const showMuni = activeLayers.has("municipalities");
    const showPlants = activeLayers.has("generation") || activeLayers.has("infrastructure");
    const showSubs = activeLayers.has("infrastructure");

    const setVis = (id: string, visible: boolean) => {
      if (!map.getLayer(id)) return;
      map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
    };
    setVis("municipalities-fill", showMuni);
    setVis("municipalities-outline", showMuni);
    setVis("osm-plants", showPlants);
    setVis("osm-substations", showSubs);
  }

  function addDataLayers(map: MlMap) {
    // Municipality polygons
    void fetch("/api/municipalities")
      .then((r) => (r.ok ? r.json() : null))
      .then((fc) => {
        if (!fc || map.getSource("municipalities")) return;
        map.addSource("municipalities", { type: "geojson", data: fc, promoteId: "id" });

        map.addLayer({
          id: "municipalities-fill",
          type: "fill",
          source: "municipalities",
          paint: {
            "fill-color": [
              "match",
              ["coalesce", ["get", "status"], "normal"],
              "normal", STATUS_FILL.normal,
              "watch", STATUS_FILL.watch,
              "strained", STATUS_FILL.strained,
              "critical", STATUS_FILL.critical,
              "stale", STATUS_FILL.stale,
              STATUS_FILL.unknown,
            ],
            "fill-opacity": [
              "case",
              ["boolean", ["feature-state", "hover"], false], 0.55,
              0.32,
            ],
          },
        });

        map.addLayer({
          id: "municipalities-outline",
          type: "line",
          source: "municipalities",
          paint: {
            "line-color": themeRef.current === "dark" ? "#1c1c1c" : "#fafaf9",
            "line-width": [
              "case",
              ["boolean", ["feature-state", "hover"], false], 1.5,
              0.6,
            ],
            "line-opacity": 0.85,
          },
        });

        // Hover state
        let hoveredId: string | number | null = null;
        map.on("mousemove", "municipalities-fill", (e) => {
          const f = e.features?.[0];
          if (!f) return;
          if (hoveredId !== null) {
            map.setFeatureState(
              { source: "municipalities", id: hoveredId },
              { hover: false },
            );
          }
          hoveredId = f.id as string | number;
          map.setFeatureState(
            { source: "municipalities", id: hoveredId },
            { hover: true },
          );
        });
        map.on("mouseleave", "municipalities-fill", () => {
          if (hoveredId !== null) {
            map.setFeatureState(
              { source: "municipalities", id: hoveredId },
              { hover: false },
            );
          }
          hoveredId = null;
        });

        applyLayerVisibility(map);
      })
      .catch(() => {});

    // Power infrastructure (community-mapped OSM data via /api/plants)
    void fetch("/api/plants")
      .then((r) => (r.ok ? r.json() : null))
      .then((fc) => {
        if (!fc || !fc.features || map.getSource("osm-power")) return;

        map.addSource("osm-power", { type: "geojson", data: fc });

        map.addLayer({
          id: "osm-substations",
          type: "circle",
          source: "osm-power",
          filter: ["==", ["get", "kind"], "substation"],
          paint: {
            "circle-radius": 3,
            "circle-color": "#94a3b8",
            "circle-stroke-color": themeRef.current === "dark" ? "#0a0a0a" : "#ffffff",
            "circle-stroke-width": 1,
            "circle-opacity": 0.7,
          },
        });

        map.addLayer({
          id: "osm-plants",
          type: "circle",
          source: "osm-power",
          filter: ["match", ["get", "kind"], ["plant", "generator"], true, false],
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["coalesce", ["to-number", ["get", "capacity_mw"]], 0],
              0, 4,
              100, 7,
              500, 11,
              1000, 14,
            ],
            "circle-color": [
              "match",
              ["downcase", ["to-string", ["coalesce", ["get", "fuel"], "unknown"]]],
              "oil", FUEL_COLOR.oil,
              "diesel", FUEL_COLOR.diesel,
              "gas", FUEL_COLOR.gas,
              "coal", FUEL_COLOR.coal,
              "solar", FUEL_COLOR.solar,
              "wind", FUEL_COLOR.wind,
              "hydro", FUEL_COLOR.hydro,
              "landfill", FUEL_COLOR.landfill,
              "battery", FUEL_COLOR.battery,
              FUEL_COLOR.unknown,
            ],
            "circle-stroke-color": themeRef.current === "dark" ? "#0a0a0a" : "#ffffff",
            "circle-stroke-width": 1.2,
            "circle-opacity": 0.94,
          },
        });

        map.on("mouseenter", "osm-plants", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "osm-plants", () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("click", "osm-plants", (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as Record<string, string | number | null>;
          onSelPlantRef.current?.(
            String(f.id ?? p.name ?? "plant"),
            String(p.name ?? "Unnamed plant"),
            (p.fuel as string | undefined) ?? undefined,
          );
        });

        applyLayerVisibility(map);
      })
      .catch(() => {});
  }

  return (
    <div
      id="main"
      ref={containerRef}
      role="application"
      aria-label="Puerto Rico electric grid map. Pan and zoom with mouse or arrow keys."
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    />
  );
}
