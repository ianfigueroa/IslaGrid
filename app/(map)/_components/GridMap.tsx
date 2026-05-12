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
  | "planned-work"
  | "outage-risk"
  | "reports"
  | "demand"
  | "outages-live"
  | "weather-alerts"
  | "hurricane"
  | "quakes";

// NWS event types → severity color. Falls back to a neutral amber for unknowns.
const ALERT_COLOR: Record<string, string> = {
  "Hurricane Warning":         "#7f1d1d",
  "Hurricane Watch":           "#b91c1c",
  "Tropical Storm Warning":    "#dc2626",
  "Tropical Storm Watch":      "#ea580c",
  "Flash Flood Warning":       "#dc2626",
  "Flood Warning":             "#ea580c",
  "Flood Watch":               "#f59e0b",
  "High Wind Warning":         "#ea580c",
  "Wind Advisory":             "#f59e0b",
  "Heat Advisory":             "#f97316",
  "Severe Thunderstorm Warning": "#dc2626",
  "Special Weather Statement": "#facc15",
};

function alertFillFor(event: string): string {
  return ALERT_COLOR[event] ?? "#facc15";
}

// Heuristic risk band → fill color (always warmer than grid status to avoid
// confusion between "status" and "risk").
const RISK_FILL: Record<string, string> = {
  low:      "#65a30d",
  elevated: "#eab308",
  high:     "#ea580c",
  severe:   "#dc2626",
  unknown:  "#525252",
};

// Community-report confidence band → fill color. Always warmer than risk so
// the two layers stay visually distinct when stacked.
const REPORT_FILL: Record<string, string> = {
  low:    "#fbbf24",
  medium: "#f97316",
  high:   "#dc2626",
};

// EXPERIMENTAL demand-pressure layer — see lib/demand.ts. Lime → red.
const DEMAND_FILL: Record<string, string> = {
  low:      "#a3e635",
  moderate: "#facc15",
  elevated: "#f97316",
  peak:     "#dc2626",
  unknown:  "#525252",
};

interface Props {
  onSelectMunicipality?: (id: string, name: string) => void;
  onSelectPlant?: (id: string, name: string, fuel?: string) => void;
  onMapError?: (message: string) => void;
  activeLayers: Set<ActiveLayerKey>;
  theme: "dark" | "light";
}

export function GridMap({
  onSelectMunicipality,
  onSelectPlant,
  onMapError,
  activeLayers,
  theme,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const themeRef = useRef(theme);
  const onSelMuniRef = useRef(onSelectMunicipality);
  const onSelPlantRef = useRef(onSelectPlant);
  const onMapErrorRef = useRef(onMapError);

  themeRef.current = theme;
  onSelMuniRef.current = onSelectMunicipality;
  onSelPlantRef.current = onSelectPlant;
  onMapErrorRef.current = onMapError;

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

    map.on("error", (ev) => {
      // MapLibre's typed payload uses { error: Error }
      const err = (ev as { error?: { message?: string } }).error;
      const msg = err?.message ?? "Map render error";
      // eslint-disable-next-line no-console
      console.error("[GridMap]", msg);
      onMapErrorRef.current?.(msg);
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

  // Active-layer changes -> visibility flips + overlay loads
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    applyLayerVisibility(map);
    if (activeLayers.has("outage-risk")) void loadRiskInto(map);
    if (activeLayers.has("reports")) void loadReportsInto(map);
    if (activeLayers.has("demand")) void loadDemandInto(map);
    if (activeLayers.has("hurricane")) void loadHurricaneInto(map);
    if (activeLayers.has("weather-alerts")) void loadAlertsInto(map);
    if (activeLayers.has("quakes")) void loadQuakesInto(map);
    if (activeLayers.has("outages-live")) void loadOutageMarkersInto(map);
    else clearOutageMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Array.from(activeLayers).sort().join(",")]);

  // Holders for DOM-based marker animations (sonar pings on outage events).
  const outageMarkersRef = useRef<maplibregl.Marker[]>([]);
  function clearOutageMarkers() {
    for (const m of outageMarkersRef.current) m.remove();
    outageMarkersRef.current = [];
  }

  function applyLayerVisibility(map: MlMap) {
    const showMuni = activeLayers.has("municipalities");
    const showRisk = activeLayers.has("outage-risk");
    const showDemand = activeLayers.has("demand");
    const showPlants = activeLayers.has("generation") || activeLayers.has("infrastructure");
    const showSubs = activeLayers.has("infrastructure");
    const showReports = activeLayers.has("reports");

    const setVis = (id: string, visible: boolean) => {
      if (!map.getLayer(id)) return;
      map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
    };
    // Risk + demand both override municipality status fill; demand only wins
    // when risk isn't active so the rail order maps to a clear priority.
    const showStatus = showMuni && !showRisk && !showDemand;
    setVis("municipalities-fill", showStatus);
    setVis("municipalities-outline", showMuni || showRisk || showDemand);
    setVis("municipalities-risk", showRisk);
    setVis("municipalities-demand", showDemand && !showRisk);
    setVis("osm-plants", showPlants);
    setVis("osm-substations", showSubs);
    setVis("reports-hex-fill", showReports);
    setVis("reports-hex-stroke", showReports);
    setVis("hurricane-cone-fill", activeLayers.has("hurricane"));
    setVis("hurricane-cone-stroke", activeLayers.has("hurricane"));
    setVis("hurricane-track", activeLayers.has("hurricane"));
    setVis("alerts-fill", activeLayers.has("weather-alerts"));
    setVis("alerts-stroke", activeLayers.has("weather-alerts"));
    setVis("quakes-circle", activeLayers.has("quakes"));
  }

  async function loadHurricaneInto(map: MlMap) {
    try {
      const res = await fetch("/api/hurricanes/active", { cache: "no-store" });
      if (!res.ok) return;
      const fc = await res.json();
      if (!fc || !Array.isArray(fc.features)) return;
      const existing = map.getSource("hurricane") as
        | maplibregl.GeoJSONSource
        | undefined;
      if (existing) {
        existing.setData(fc);
      } else {
        map.addSource("hurricane", { type: "geojson", data: fc });
        map.addLayer({
          id: "hurricane-cone-fill",
          type: "fill",
          source: "hurricane",
          filter: ["==", ["get", "kind"], "cone"],
          paint: {
            "fill-color": "#facc15",
            "fill-opacity": 0.12,
          },
        });
        map.addLayer({
          id: "hurricane-cone-stroke",
          type: "line",
          source: "hurricane",
          filter: ["==", ["get", "kind"], "cone"],
          paint: {
            "line-color": "#fde047",
            "line-width": 1.4,
            "line-dasharray": [2, 2],
            "line-opacity": 0.7,
          },
        });
        map.addLayer({
          id: "hurricane-track",
          type: "line",
          source: "hurricane",
          filter: ["==", ["get", "kind"], "track"],
          paint: {
            "line-color": "#fef08a",
            "line-width": 2,
            "line-opacity": 0.9,
          },
        });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[GridMap] hurricane load failed", err);
      onMapErrorRef.current?.("Hurricane forecast failed to load.");
    }
  }

  async function loadAlertsInto(map: MlMap) {
    try {
      const res = await fetch("/api/weather/alerts", { cache: "no-store" });
      if (!res.ok) return;
      const fc = await res.json();
      if (!fc || !Array.isArray(fc.features)) return;
      // Tag each feature with a resolved color so we can render via a
      // 'get' expression rather than a long match in MapLibre.
      type AlertFeature = GeoJSON.Feature<GeoJSON.Geometry, { event?: string; _color?: string }>;
      for (const f of fc.features as AlertFeature[]) {
        f.properties = {
          ...f.properties,
          _color: alertFillFor(f.properties?.event ?? ""),
        };
      }
      const existing = map.getSource("alerts") as
        | maplibregl.GeoJSONSource
        | undefined;
      if (existing) {
        existing.setData(fc);
      } else {
        map.addSource("alerts", { type: "geojson", data: fc });
        map.addLayer({
          id: "alerts-fill",
          type: "fill",
          source: "alerts",
          paint: {
            "fill-color": ["coalesce", ["get", "_color"], "#facc15"],
            "fill-opacity": 0.18,
          },
        });
        map.addLayer({
          id: "alerts-stroke",
          type: "line",
          source: "alerts",
          paint: {
            "line-color": ["coalesce", ["get", "_color"], "#facc15"],
            "line-width": 1.2,
            "line-opacity": 0.8,
          },
        });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[GridMap] alerts load failed", err);
      onMapErrorRef.current?.("NWS alerts failed to load.");
    }
  }

  async function loadQuakesInto(map: MlMap) {
    try {
      const res = await fetch("/api/quakes", { cache: "no-store" });
      if (!res.ok) return;
      const fc = await res.json();
      if (!fc || !Array.isArray(fc.features)) return;
      const existing = map.getSource("quakes") as
        | maplibregl.GeoJSONSource
        | undefined;
      if (existing) {
        existing.setData(fc);
      } else {
        map.addSource("quakes", { type: "geojson", data: fc });
        map.addLayer({
          id: "quakes-circle",
          type: "circle",
          source: "quakes",
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["coalesce", ["to-number", ["get", "mag"]], 2],
              2, 3,
              4, 7,
              6, 13,
            ],
            "circle-color": "#a855f7",
            "circle-opacity": 0.55,
            "circle-stroke-color": "#f5d0fe",
            "circle-stroke-width": 1,
          },
        });
        map.on("click", "quakes-circle", (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as { mag?: number; place?: string; url?: string; title?: string };
          // eslint-disable-next-line no-alert
          if (p?.url && typeof window !== "undefined") window.open(p.url, "_blank", "noopener");
        });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[GridMap] quakes load failed", err);
      onMapErrorRef.current?.("USGS earthquakes failed to load.");
    }
  }

  async function loadOutageMarkersInto(map: MlMap) {
    try {
      const res = await fetch(
        `/api/disaster/snapshot`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const json = (await res.json()) as {
        outage_events?: Array<{
          id: string;
          municipality_id: string | null;
          started_at: string;
          ended_at: string | null;
          kind: string;
        }>;
      };
      const events = (json.outage_events ?? []).filter(
        (e) => !e.ended_at && e.municipality_id && e.kind === "unplanned",
      );
      if (events.length === 0) {
        clearOutageMarkers();
        return;
      }
      // We need muni centroids for marker placement. Lazy fetch the
      // municipalities source if it isn't loaded yet.
      const src = map.getSource("municipalities") as
        | maplibregl.GeoJSONSource
        | undefined;
      if (!src) return;
      const data = (src as unknown as { _data?: GeoJSON.FeatureCollection })._data;
      if (!data?.features) return;
      const centroidById = new Map<string, [number, number]>();
      for (const f of data.features) {
        const id = (f.properties as { id?: string } | null)?.id;
        if (!id) continue;
        const c = approxCentroid(f.geometry);
        if (c) centroidById.set(id, c);
      }
      clearOutageMarkers();
      for (const ev of events) {
        const c = ev.municipality_id ? centroidById.get(ev.municipality_id) : null;
        if (!c) continue;
        const el = document.createElement("div");
        el.style.position = "relative";
        el.style.width = "14px";
        el.style.height = "14px";
        el.innerHTML = `
          <span class="sonar-ping" style="width:14px;height:14px;background:#ef4444;opacity:0.6"></span>
          <span class="sonar-ping sonar-ping-delayed" style="width:14px;height:14px;background:#ef4444;opacity:0.6"></span>
          <span style="position:absolute;left:50%;top:50%;width:8px;height:8px;border-radius:9999px;background:#ef4444;transform:translate(-50%,-50%);box-shadow:0 0 0 1px #fef2f2"></span>
        `;
        const marker = new maplibregl.Marker({ element: el }).setLngLat(c).addTo(map);
        outageMarkersRef.current.push(marker);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[GridMap] outage markers failed", err);
    }
  }

  function approxCentroid(geom: GeoJSON.Geometry): [number, number] | null {
    if (geom.type === "Polygon") {
      const ring = geom.coordinates[0];
      if (!ring || ring.length === 0) return null;
      let sx = 0;
      let sy = 0;
      for (const [x, y] of ring) {
        sx += x;
        sy += y;
      }
      return [sx / ring.length, sy / ring.length];
    }
    if (geom.type === "MultiPolygon") {
      const ring = geom.coordinates[0]?.[0];
      if (!ring || ring.length === 0) return null;
      let sx = 0;
      let sy = 0;
      for (const [x, y] of ring) {
        sx += x;
        sy += y;
      }
      return [sx / ring.length, sy / ring.length];
    }
    return null;
  }

  async function loadDemandInto(map: MlMap) {
    try {
      const res = await fetch("/api/demand/municipalities", { cache: "no-store" });
      if (!res.ok) throw new Error(`/api/demand/municipalities ${res.status}`);
      const json = (await res.json()) as {
        items: Array<{ municipality_id: string; band: string }>;
      };
      if (!map.getSource("municipalities")) return;
      for (const row of json.items) {
        map.setFeatureState(
          { source: "municipalities", id: row.municipality_id },
          { demand_band: row.band },
        );
      }
      if (map.getLayer("municipalities-demand")) return;
      map.addLayer(
        {
          id: "municipalities-demand",
          type: "fill",
          source: "municipalities",
          paint: {
            "fill-color": [
              "match",
              ["coalesce", ["feature-state", "demand_band"], "unknown"],
              "low",      DEMAND_FILL.low,
              "moderate", DEMAND_FILL.moderate,
              "elevated", DEMAND_FILL.elevated,
              "peak",     DEMAND_FILL.peak,
              DEMAND_FILL.unknown,
            ],
            "fill-opacity": [
              "case",
              ["boolean", ["feature-state", "hover"], false], 0.55,
              0.42,
            ],
          },
        },
        "municipalities-outline",
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[GridMap] demand load failed", err);
      onMapErrorRef.current?.("Demand heatmap failed to load.");
    }
  }

  async function loadReportsInto(map: MlMap) {
    try {
      const res = await fetch("/api/reports/aggregate", { cache: "no-store" });
      if (!res.ok) throw new Error(`/api/reports/aggregate ${res.status}`);
      const fc = await res.json();
      if (!fc || !Array.isArray(fc.features)) return;
      const existing = map.getSource("reports") as
        | maplibregl.GeoJSONSource
        | undefined;
      if (existing) {
        existing.setData(fc);
        return;
      }
      map.addSource("reports", { type: "geojson", data: fc });
      map.addLayer({
        id: "reports-hex-fill",
        type: "fill",
        source: "reports",
        paint: {
          "fill-color": [
            "match",
            ["coalesce", ["get", "band"], "low"],
            "low",    REPORT_FILL.low,
            "medium", REPORT_FILL.medium,
            "high",   REPORT_FILL.high,
            REPORT_FILL.low,
          ],
          "fill-opacity": 0.35,
        },
      });
      map.addLayer({
        id: "reports-hex-stroke",
        type: "line",
        source: "reports",
        paint: {
          "line-color": "#facc15",
          "line-opacity": 0.5,
          "line-width": 0.8,
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[GridMap] reports load failed", err);
      onMapErrorRef.current?.("Community reports failed to load.");
    }
  }

  async function loadRiskInto(map: MlMap) {
    if (map.getLayer("municipalities-risk")) return;
    try {
      const res = await fetch("/api/risk/municipalities", { cache: "no-store" });
      if (!res.ok) return;
      const { items } = (await res.json()) as {
        items: Array<{ municipality_id: string; band: string }>;
      };
      const byId = new Map(items.map((r) => [r.municipality_id, r.band]));
      if (!map.getSource("municipalities")) return;
      // Use the same source but write feature state for `band`.
      for (const [id, band] of byId) {
        map.setFeatureState({ source: "municipalities", id }, { band });
      }
      map.addLayer(
        {
          id: "municipalities-risk",
          type: "fill",
          source: "municipalities",
          paint: {
            "fill-color": [
              "match",
              ["coalesce", ["feature-state", "band"], "unknown"],
              "low",      RISK_FILL.low,
              "elevated", RISK_FILL.elevated,
              "high",     RISK_FILL.high,
              "severe",   RISK_FILL.severe,
              RISK_FILL.unknown,
            ],
            "fill-opacity": [
              "case",
              ["boolean", ["feature-state", "hover"], false], 0.55,
              0.42,
            ],
          },
        },
        "municipalities-outline",
      );
    } catch {
      /* leave the layer off; the rail toggle stays available */
    }
  }

  function addDataLayers(map: MlMap) {
    // Municipality polygons
    void fetch("/api/municipalities")
      .then((r) => {
        if (!r.ok) throw new Error(`/api/municipalities ${r.status}`);
        return r.json();
      })
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
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[GridMap] municipalities fetch failed", err);
        onMapErrorRef.current?.("Municipality boundaries failed to load.");
      });

    // Power infrastructure (community-mapped OSM data via /api/plants)
    void fetch("/api/plants")
      .then((r) => {
        if (!r.ok) throw new Error(`/api/plants ${r.status}`);
        return r.json();
      })
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
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[GridMap] plants fetch failed", err);
        onMapErrorRef.current?.("Power infrastructure failed to load.");
      });
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
