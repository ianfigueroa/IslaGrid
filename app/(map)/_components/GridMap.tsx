"use client";

import { useEffect, useRef } from "react";
import maplibregl, { Map as MlMap } from "maplibre-gl";

// Basemap — OpenFreeMap Liberty for BOTH themes. Carto's dark-matter style
// returned "Zoom Level Not Supported" placeholder tiles for sparse Caribbean
// regions, which ate the canvas. Liberty has dense planet coverage at zoom
// 0-15 and a single style.json works everywhere. "Dark" mode just dims the
// land via paint props in style.load below; everything else stays the same.
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

function styleUrl(_theme: "dark" | "light"): string {
  return STYLE_URL;
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

// Per-municipality status fill — kept warm + readable over Voyager.
const STATUS_FILL: Record<string, string> = {
  normal: "#10b981",
  watch: "#f59e0b",
  strained: "#fb923c",
  critical: "#ef4444",
  stale: "#94a3b8",
  unknown: "#cbd5e1",
};

// Wind speed → hex color stops (matches Windy's wind layer). kph values.
const WIND_STOPS = [
  [0, "#dbeafe"],
  [10, "#bae6fd"],
  [25, "#7dd3fc"],
  [40, "#38bdf8"],
  [60, "#0284c7"],
  [80, "#7c3aed"],
  [110, "#dc2626"],
] as const;

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
  | "quakes"
  | "rain-radar"
  | "wind";

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

  // Mirror activeLayers into a ref so the style.load handler (which only
  // closes over the first render's props) can check what's currently on.
  const activeLayersRef = useRef(activeLayers);
  activeLayersRef.current = activeLayers;

  // Cached GeoJSON so we don't re-fetch on every theme/style swap. Populated
  // by the initial addDataLayers fetches and re-used by the style.load
  // handler when MapLibre swaps the basemap style.
  const cacheRef = useRef<{
    munis?: GeoJSON.FeatureCollection;
    plants?: GeoJSON.FeatureCollection;
  }>({});

  // One-time map setup
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrl(theme),
      center: [-66.5, 18.23],
      zoom: 8.4,
      // OpenFreeMap returns a "Zoom Level Not Supported" placeholder image
      // (not a 404) for tiles outside their dense vector coverage. Stay at
      // zoom 7 or deeper, and bound the viewport tight around PR + USVI to
      // avoid requesting tiles in regions where coverage thins.
      minZoom: 7,
      maxZoom: 16,
      maxBounds: [
        [-68.5, 17.4],
        [-64.4, 19.1],
      ],
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

    // style.load fires on initial load AND every setStyle() call. We use it
    // (not 'load') so theme swaps re-attach our data layers.
    map.on("style.load", () => {
      // Soften OpenFreeMap labels slightly so muni names + plant markers stay
      // legible without competing visually with the data overlays.
      try {
        const style = map.getStyle();
        for (const layer of style.layers ?? []) {
          if (layer.type === "symbol" && layer.id.includes("label")) {
            const id = layer.id;
            try {
              map.setPaintProperty(id, "text-halo-width", 1.4);
            } catch {
              /* property may not exist on this layer */
            }
          }
        }
      } catch {
        /* style not ready yet — no-op */
      }
      addDataLayers(map);
      applyLayerVisibility(map);
      // setStyle() wipes runtime layers including the rain-radar frames. If
      // the user had rain on, reset state and restart so the animation
      // resumes after a theme swap (otherwise the frames just disappear).
      if (activeLayersRef.current.has("rain-radar")) {
        rainStateRef.current.frames = [];
        rainStateRef.current.cursor = 0;
        if (rainStateRef.current.timer != null) {
          window.clearInterval(rainStateRef.current.timer);
          rainStateRef.current.timer = null;
        }
        startRainRadar(map);
      }
      if (activeLayersRef.current.has("wind")) void loadWindInto(map);
    });

    map.on("error", (ev) => {
      // MapLibre's typed payload uses { error: Error }
      const err = (ev as { error?: { message?: string } }).error;
      const msg = err?.message ?? "Map render error";
      // eslint-disable-next-line no-console
      console.error("[GridMap]", msg);
      onMapErrorRef.current?.(msg);
    });

    // Clicks bind to the ALWAYS-visible "municipalities-hit" layer (opacity 0
    // but interactive) so user can pick a muni even when status/risk/demand
    // layers are toggled off. The hit layer is added inside addMuniLayers.
    map.on("click", "municipalities-hit", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties as { id: string; name: string };
      onSelMuniRef.current?.(p.id, p.name);
    });

    map.on("mouseenter", "municipalities-hit", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "municipalities-hit", () => {
      map.getCanvas().style.cursor = "";
    });

    mapRef.current = map;

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);
    requestAnimationFrame(() => map.resize());

    return () => {
      ro.disconnect();
      // Clear the rain animation timer before tearing down the map so it
      // doesn't keep firing against a removed canvas.
      if (rainStateRef.current.timer != null) {
        window.clearInterval(rainStateRef.current.timer);
        rainStateRef.current.timer = null;
      }
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme swap — setStyle wipes our sources/layers; style.load handler
  // re-attaches everything from the cache.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(styleUrl(theme));
    // style.load handler does the rest (addDataLayers → applyLayerVisibility).
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
    if (activeLayers.has("rain-radar")) startRainRadar(map);
    else stopRainRadar(map);
    if (activeLayers.has("wind")) void loadWindInto(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Array.from(activeLayers).sort().join(",")]);

  // Holders for DOM-based marker animations (sonar pings on outage events).
  const outageMarkersRef = useRef<maplibregl.Marker[]>([]);
  function clearOutageMarkers() {
    for (const m of outageMarkersRef.current) m.remove();
    outageMarkersRef.current = [];
  }

  // Rain-radar animation state. RainViewer publishes a manifest with ~12 past
  // frames (a moving 2-hour window). We add one raster source per frame and
  // step through them with `raster-opacity` so the map "plays" precipitation.
  const rainStateRef = useRef<{
    frames: { id: string; time: number }[];
    cursor: number;
    timer: number | null;
  }>({ frames: [], cursor: 0, timer: null });

  function stopRainRadar(map: MlMap) {
    const s = rainStateRef.current;
    if (s.timer != null) {
      window.clearInterval(s.timer);
      s.timer = null;
    }
    for (const f of s.frames) {
      if (map.getLayer(f.id)) map.removeLayer(f.id);
      if (map.getSource(f.id)) map.removeSource(f.id);
    }
    s.frames = [];
    s.cursor = 0;
  }

  function startRainRadar(map: MlMap) {
    // No-op if already running.
    if (rainStateRef.current.timer != null) return;
    void (async () => {
      try {
        const res = await fetch("https://api.rainviewer.com/public/weather-maps.json", {
          cache: "no-store",
        });
        if (!res.ok) return;
        type RVManifest = {
          host: string;
          radar?: { past?: Array<{ path: string; time: number }> };
        };
        const json = (await res.json()) as RVManifest;
        const past = json.radar?.past ?? [];
        if (past.length === 0) return;
        // Use the last 8 frames — enough to "play" the storm without spamming
        // the GPU with too many concurrent raster layers.
        const frames = past.slice(-8);
        const host = json.host;
        // Insert as a stack BENEATH the muni outline so borders stay sharp.
        const beforeId = map.getLayer("municipalities-outline")
          ? "municipalities-outline"
          : undefined;
        for (const f of frames) {
          const id = `rain-${f.time}`;
          if (map.getSource(id)) continue;
          map.addSource(id, {
            type: "raster",
            // Color scheme 6 = Blue→Purple (Windy-like); size 512; smooth=1
            tiles: [`${host}${f.path}/512/{z}/{x}/{y}/6/1_0.png`],
            tileSize: 512,
            attribution:
              '<a href="https://www.rainviewer.com" target="_blank" rel="noreferrer">RainViewer</a>',
          });
          map.addLayer(
            {
              id,
              type: "raster",
              source: id,
              paint: { "raster-opacity": 0 },
            },
            beforeId,
          );
        }
        rainStateRef.current.frames = frames.map((f) => ({
          id: `rain-${f.time}`,
          time: f.time,
        }));
        rainStateRef.current.cursor = 0;
        const tick = () => {
          const m = mapRef.current;
          const s = rainStateRef.current;
          if (!m || s.frames.length === 0) return;
          for (let i = 0; i < s.frames.length; i++) {
            if (!m.getLayer(s.frames[i].id)) continue;
            m.setPaintProperty(
              s.frames[i].id,
              "raster-opacity",
              i === s.cursor ? 0.65 : 0,
            );
          }
          s.cursor = (s.cursor + 1) % s.frames.length;
        };
        tick();
        // 600ms per frame ≈ 5s loop for 8 frames — visible motion, no jitter.
        rainStateRef.current.timer = window.setInterval(tick, 600);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[GridMap] rain radar failed", err);
        onMapErrorRef.current?.("Rain radar failed to load.");
      }
    })();
  }

  async function loadWindInto(map: MlMap) {
    if (map.getLayer("wind-fill")) return;
    // Concurrent callers (style.load + activeLayers effect) can both pass the
    // pre-fetch check; the post-await guard below catches that race.
    try {
      // Pull the latest hour of weather snapshots per muni. The endpoint is
      // already served by /api/weather/latest; if not present, fall back to
      // the risk endpoint which includes wind_kph indirectly via reasons.
      const res = await fetch("/api/weather/latest", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as {
        items?: Array<{ municipality_id: string; wind_kph?: number; gust_kph?: number }>;
      };
      const byId = new Map<string, number>();
      for (const r of json.items ?? []) {
        const w = Math.max(r.gust_kph ?? 0, r.wind_kph ?? 0);
        if (w > 0) byId.set(r.municipality_id, w);
      }
      if (!map.getSource("municipalities")) return;
      for (const [id, w] of byId) {
        map.setFeatureState({ source: "municipalities", id }, { wind_kph: w });
      }
      if (map.getLayer("wind-fill")) return;
      map.addLayer(
        {
          id: "wind-fill",
          type: "fill",
          source: "municipalities",
          paint: {
            "fill-color": [
              "interpolate",
              ["linear"],
              ["coalesce", ["feature-state", "wind_kph"], 0],
              ...WIND_STOPS.flatMap(([v, c]) => [v as number, c as string]),
            ],
            "fill-opacity": 0.42,
          },
        },
        "municipalities-outline",
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[GridMap] wind load failed", err);
      onMapErrorRef.current?.("Wind layer failed to load.");
    }
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
    setVis("municipalities-hover", showMuni || showRisk || showDemand);
    setVis("municipalities-risk", showRisk);
    setVis("municipalities-demand", showDemand && !showRisk);
    setVis("osm-plants", showPlants);
    setVis("osm-plants-glow", showPlants);
    setVis("osm-substations", showSubs);
    setVis("reports-hex-fill", showReports);
    setVis("reports-hex-stroke", showReports);
    setVis("hurricane-cone-fill", activeLayers.has("hurricane"));
    setVis("hurricane-cone-stroke", activeLayers.has("hurricane"));
    setVis("hurricane-track", activeLayers.has("hurricane"));
    setVis("alerts-fill", activeLayers.has("weather-alerts"));
    setVis("alerts-stroke", activeLayers.has("weather-alerts"));
    setVis("quakes-circle", activeLayers.has("quakes"));
    setVis("wind-fill", activeLayers.has("wind"));
    // rain frames are managed via startRainRadar / stopRainRadar
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
      // Recheck after the await: a concurrent caller may have added it.
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
      if (map.getLayer("municipalities-risk")) return;
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

  function addMuniLayers(map: MlMap, fc: GeoJSON.FeatureCollection) {
    if (map.getSource("municipalities")) return;
    map.addSource("municipalities", { type: "geojson", data: fc, promoteId: "id" });

    // Invisible hit layer — always present so clicks register regardless of
    // which paint layer (status/risk/demand) is currently visible. Opacity 0
    // still receives pointer events in MapLibre.
    map.addLayer({
      id: "municipalities-hit",
      type: "fill",
      source: "municipalities",
      paint: { "fill-color": "#000000", "fill-opacity": 0 },
    });

    // Status fill — kept VERY subtle so the OpenFreeMap land/water rendering
    // shows through. Only colors strongly when status ≠ unknown/normal.
    map.addLayer({
      id: "municipalities-fill",
      type: "fill",
      source: "municipalities",
      paint: {
        "fill-color": [
          "match",
          ["coalesce", ["get", "status"], "unknown"],
          "normal", STATUS_FILL.normal,
          "watch", STATUS_FILL.watch,
          "strained", STATUS_FILL.strained,
          "critical", STATUS_FILL.critical,
          "stale", STATUS_FILL.stale,
          STATUS_FILL.unknown,
        ],
        "fill-opacity": [
          "case",
          ["boolean", ["feature-state", "hover"], false], 0.32,
          ["match",
            ["coalesce", ["get", "status"], "unknown"],
            "unknown", 0,
            "stale",   0.04,
            0.18,
          ],
        ],
      },
    });

    map.addLayer({
      id: "municipalities-outline",
      type: "line",
      source: "municipalities",
      paint: {
        "line-color": themeRef.current === "dark" ? "#94a3b8" : "#1e293b",
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          7, 0.5,
          9, 0.9,
          11, 1.4,
        ],
        "line-opacity": [
          "case",
          ["boolean", ["feature-state", "hover"], false], 1,
          0.55,
        ],
      },
    });

    // Hover highlight (separate layer so the fill stays subtle on idle)
    map.addLayer({
      id: "municipalities-hover",
      type: "line",
      source: "municipalities",
      paint: {
        "line-color": themeRef.current === "dark" ? "#38bdf8" : "#0284c7",
        "line-width": 2.4,
        "line-opacity": [
          "case",
          ["boolean", ["feature-state", "hover"], false], 1,
          0,
        ],
      },
    });

    // Hover state — bound to the always-on hit layer so hover works even when
    // status/risk/demand fills are toggled off.
    let hoveredId: string | number | null = null;
    map.on("mousemove", "municipalities-hit", (e) => {
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
    map.on("mouseleave", "municipalities-hit", () => {
      if (hoveredId !== null) {
        map.setFeatureState(
          { source: "municipalities", id: hoveredId },
          { hover: false },
        );
      }
      hoveredId = null;
    });
  }

  function addPlantLayers(map: MlMap, fc: GeoJSON.FeatureCollection) {
    if (map.getSource("osm-power")) return;
    map.addSource("osm-power", { type: "geojson", data: fc });

    map.addLayer({
      id: "osm-substations",
      type: "circle",
      source: "osm-power",
      filter: ["==", ["get", "kind"], "substation"],
      paint: {
        "circle-radius": 3,
        "circle-color": "#94a3b8",
        "circle-stroke-color": themeRef.current === "dark" ? "#07101f" : "#ffffff",
        "circle-stroke-width": 1,
        "circle-opacity": 0.7,
      },
    });

    // Plant glow — soft halo behind each plant marker. Fuel-tinted so renewables
    // read green/teal, fossils warm. Sized 2.5× the marker so it bleeds out like
    // a lit node rather than a flat dot.
    const FUEL_MATCH = [
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
    ] as unknown as maplibregl.ExpressionSpecification;

    // OSM tags individual PV panels, wind turbines, and battery cells as
    // separate `generator` nodes — rendering them all paints fake clusters
    // on top of solar farms. Restrict the plant layer to `kind: "plant"`
    // (the consolidated facility polygon) so each plant is exactly one dot.
    map.addLayer({
      id: "osm-plants-glow",
      type: "circle",
      source: "osm-power",
      filter: ["==", ["get", "kind"], "plant"],
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["coalesce", ["to-number", ["get", "capacity_mw"]], 0],
          0, 10,
          100, 18,
          500, 28,
          1000, 36,
        ],
        "circle-color": FUEL_MATCH,
        "circle-opacity": 0.22,
        "circle-blur": 1.1,
      },
    });

    map.addLayer({
      id: "osm-plants",
      type: "circle",
      source: "osm-power",
      filter: ["==", ["get", "kind"], "plant"],
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["coalesce", ["to-number", ["get", "capacity_mw"]], 0],
          0, 4.5,
          100, 7.5,
          500, 11,
          1000, 14,
        ],
        "circle-color": FUEL_MATCH,
        "circle-stroke-color": themeRef.current === "dark" ? "#0b1a33" : "#ffffff",
        "circle-stroke-width": 1.6,
        "circle-opacity": 0.96,
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
  }

  function addDataLayers(map: MlMap) {
    // Use cached data if available so theme swaps don't re-fetch.
    if (cacheRef.current.munis) {
      addMuniLayers(map, cacheRef.current.munis);
    } else {
      void fetch("/api/municipalities")
        .then((r) => {
          if (!r.ok) throw new Error(`/api/municipalities ${r.status}`);
          return r.json();
        })
        .then((fc: GeoJSON.FeatureCollection) => {
          if (!fc) return;
          cacheRef.current.munis = fc;
          if (!mapRef.current) return;
          addMuniLayers(mapRef.current, fc);
          applyLayerVisibility(mapRef.current);
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.error("[GridMap] municipalities fetch failed", err);
          onMapErrorRef.current?.("Municipality boundaries failed to load.");
        });
    }

    if (cacheRef.current.plants) {
      addPlantLayers(map, cacheRef.current.plants);
    } else {
      void fetch("/api/plants")
        .then((r) => {
          if (!r.ok) throw new Error(`/api/plants ${r.status}`);
          return r.json();
        })
        .then((fc: GeoJSON.FeatureCollection) => {
          if (!fc || !fc.features) return;
          cacheRef.current.plants = fc;
          if (!mapRef.current) return;
          addPlantLayers(mapRef.current, fc);
          applyLayerVisibility(mapRef.current);
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.error("[GridMap] plants fetch failed", err);
          onMapErrorRef.current?.("Power infrastructure failed to load.");
        });
    }
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
