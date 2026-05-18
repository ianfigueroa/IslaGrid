"use client";

import { useEffect, useRef } from "react";
import maplibregl, { Map as MlMap } from "maplibre-gl";
import { Protocol } from "pmtiles";
import { layers as protomapsLayers, namedFlavor } from "@protomaps/basemaps";

// Register the pmtiles:// protocol with MapLibre once per page load. Calling
// this twice is harmless — addProtocol replaces the previous handler — but
// guarding keeps the console clean during HMR.
let _pmtilesRegistered = false;
function ensurePmtilesProtocol() {
  if (_pmtilesRegistered) return;
  // MapLibre v5 types accept the Protocol's tile handler signature directly.
  maplibregl.addProtocol("pmtiles", new Protocol().tile);
  _pmtilesRegistered = true;
}

// Custom Protomaps flavor: we start from the stock "light"/"dark" flavor and
// override a small palette so the basemap reads as a civic data layer instead
// of a generic city map. Warm cream land + muted teal water in light;
// deep navy land + abyss water in dark. Roads stay quiet so the data on top
// (risk, outages, plants) dominates the eye.
// In Protomaps, "background" is the void color that shows everywhere a
// pmtiles tile hasn't loaded — including the area beyond our tile bbox.
// Setting it to the ocean color lets the open water above PR's north coast
// read as ocean instead of an empty white strip. "water" is the explicit
// inland-water + coastal fill inside the tile coverage; we keep both in
// sync so the seam is invisible.
function flavorFor(theme: "light" | "dark") {
  const base = namedFlavor(theme);
  if (theme === "dark") {
    return {
      ...base,
      background: "#03101c",
      earth: "#0a1726",
      park_a: "#0e2233",
      park_b: "#0c1c2c",
      hospital: "#1f1b2e",
      industrial: "#0d1825",
      school: "#0e1828",
      wood_a: "#0d1f2a",
      wood_b: "#0c1d28",
      pedestrian: "#0a1626",
      scrub_a: "#0d1d2a",
      scrub_b: "#0c1c28",
      glacier: "#102232",
      sand: "#1a2236",
      beach: "#1a2236",
      farmland: "#0c1a28",
      water: "#03101c",
      zoo: "#0d1c28",
      military: "#0e1828",
    } as const;
  }
  return {
    ...base,
    background: "#bcd8eb",
    earth: "#f7f1e6",
    park_a: "#dfead0",
    park_b: "#e6efd9",
    water: "#bcd8eb",
    sand: "#f0e6c8",
    beach: "#f3e8c8",
    farmland: "#eee6cf",
  } as const;
}

const PMTILES_URL = "/map/pr.pmtiles";

function protomapsStyle(theme: "light" | "dark"): maplibregl.StyleSpecification {
  // Generate the layer stack from our flavor + the standard OSM source key
  // expected by Protomaps' v4 schema ("protomaps").
  // Protomaps' generated stack already starts with its own background layer,
  // and flavorFor() above sets that layer's color to ocean blue. So an extra
  // prepended ocean-background layer would just be hidden underneath.
  const layers = protomapsLayers("protomaps", flavorFor(theme), {
    lang: "es",
  }) as maplibregl.LayerSpecification[];
  return {
    version: 8,
    glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
    sprite: "https://protomaps.github.io/basemaps-assets/sprites/v4/light",
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${PMTILES_URL}`,
        attribution:
          '<a href="https://protomaps.com" target="_blank" rel="noreferrer">Protomaps</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>',
      },
    },
    layers,
  };
}

// Esri satellite is a separate (raster) flavor and stays as-is.
export type Basemap = "light" | "dark" | "satellite";

function satelliteStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        // Esri World Imagery — free for non-commercial use, dense global cover.
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        attribution:
          'Imagery © <a href="https://www.esri.com" target="_blank" rel="noreferrer">Esri</a>',
        minzoom: 0,
        maxzoom: 19,
      },
    },
    layers: [{ id: "basemap", type: "raster", source: "basemap" }],
    glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
  };
}

function styleFor(basemap: Basemap): maplibregl.StyleSpecification {
  if (basemap === "satellite") return satelliteStyle();
  return protomapsStyle(basemap === "dark" ? "dark" : "light");
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

// Per-municipality status fill — kept warm + readable over the Protomaps
// light flavor. Saturation stays mid so colors register without overpowering
// the basemap.
const STATUS_FILL: Record<string, string> = {
  normal: "#10b981",
  watch: "#f59e0b",
  strained: "#fb923c",
  critical: "#ef4444",
  stale: "#94a3b8",
  unknown: "#cbd5e1",
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
  onSelectPlant?: (
    id: string,
    name: string,
    fuel?: string,
    capacityMw?: number | null,
  ) => void;
  onMapError?: (message: string) => void;
  activeLayers: Set<ActiveLayerKey>;
  theme: "dark" | "light";
  /** When set, overrides theme-derived basemap (used for the Satellite toggle). */
  basemap?: Basemap;
}

export function GridMap({
  onSelectMunicipality,
  onSelectPlant,
  onMapError,
  activeLayers,
  theme,
  basemap,
}: Props) {
  const effectiveBasemap: Basemap = basemap ?? theme;
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

    // Register pmtiles:// before any map instance touches the URL.
    ensurePmtilesProtocol();

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleFor(effectiveBasemap),
      center: [-66.5, 18.225],
      // Pulled way back so the whole island sits comfortably inside the
      // viewport with the floating chrome around it. Earlier 6.9/7.4 values
      // still felt cramped against the pills + panels.
      zoom: 6.5,
      // pr.pmtiles covers PR + USVI at zoom 0–14; MapLibre over-zooms
      // (stretches) z14 tiles up to 16 so we stay crisp at street level
      // without shipping building-detail tiles. Lower bound keeps the user
      // from zooming out to ocean-only views.
      minZoom: 5.8,
      maxZoom: 16,
      // Match pr.pmtiles' actual bbox (read from the v3 header). Earlier code
      // used a wider box that included USVI, but the basemap has no tiles east
      // of -65.2°, so panning over there left an empty white strip. If we ever
      // regenerate pr.pmtiles wider, bump these too. The bounds box is padded
      // slightly so users can pan/zoom out for breathing room.
      maxBounds: [
        [-68.3, 17.5],
        [-65.0, 18.85],
      ],
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

    // style.load fires on initial load AND every setStyle() call. We use it
    // (not 'load') so theme swaps re-attach our data layers.
    map.on("style.load", () => {
      // Soften basemap labels slightly so muni names + plant markers stay
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
      if (activeLayersRef.current.has("outages-live")) void loadFeederOutagesInto(map);
      if (activeLayersRef.current.has("planned-work")) void loadPlannedWorkInto(map);
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
    map.setStyle(styleFor(effectiveBasemap));
    // style.load handler does the rest (addDataLayers → applyLayerVisibility).
  }, [effectiveBasemap]);

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
    if (activeLayers.has("outages-live")) {
      void loadOutageMarkersInto(map);
      void loadFeederOutagesInto(map);
    } else clearOutageMarkers();
    if (activeLayers.has("planned-work")) void loadPlannedWorkInto(map);
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
    // AEE/PREPA feeder outages ride along with the "outages-live" toggle.
    // The muni-overlay smear (LUMA region totals) also rides this toggle but
    // its loader decides whether to actually show it (only when AEEPR was
    // empty); off here just covers the user toggling the pill back off.
    const showOutages = activeLayers.has("outages-live");
    setVis("feeders-outage-fill", showOutages);
    setVis("feeders-outage-stroke", showOutages);
    setVis("feeders-loadshed-fill", showOutages);
    setVis("feeders-loadshed-stroke", showOutages);
    if (!showOutages) {
      setVis("muni-outage-overlay-fill", false);
      setVis("muni-outage-overlay-stroke", false);
    }
    const showPlanned = activeLayers.has("planned-work");
    setVis("planned-work-halo", showPlanned);
    setVis("planned-work-dot", showPlanned);
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
      // We need muni centroids for marker placement. Use the cached muni
      // GeoJSON (populated by addDataLayers) rather than poking MapLibre's
      // private source internals.
      const data = cacheRef.current.munis;
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

  async function loadFeederOutagesInto(map: MlMap) {
    try {
      const res = await fetch("/api/outages/feeders", { cache: "no-store" });
      if (!res.ok) return;
      const fc = await res.json();
      if (!fc || !Array.isArray(fc.features)) return;
      // AEEPR feeders are often empty between pushes; the muni overlay
      // smears the LUMA region totals across munis so the user still sees
      // affected areas. Load it in parallel so both paint together.
      void loadMuniOutageOverlayInto(map, fc.features.length === 0);
      const existing = map.getSource("aeepr-feeders") as
        | maplibregl.GeoJSONSource
        | undefined;
      if (existing) {
        existing.setData(fc);
        return;
      }
      map.addSource("aeepr-feeders", { type: "geojson", data: fc });
      // Active outage feeders — red. Tucked above the muni outline so they
      // don't blow out the choropleth, but still under labels.
      map.addLayer(
        {
          id: "feeders-outage-fill",
          type: "fill",
          source: "aeepr-feeders",
          filter: ["==", ["get", "kind"], "outage"],
          paint: {
            "fill-color": "#ef4444",
            "fill-opacity": 0.42,
          },
        },
        "municipalities-outline",
      );
      map.addLayer(
        {
          id: "feeders-outage-stroke",
          type: "line",
          source: "aeepr-feeders",
          filter: ["==", ["get", "kind"], "outage"],
          paint: {
            "line-color": "#fee2e2",
            "line-width": 1.1,
            "line-opacity": 0.9,
          },
        },
        "municipalities-outline",
      );
      // Projected load-shed feeders — amber dashed.
      map.addLayer(
        {
          id: "feeders-loadshed-fill",
          type: "fill",
          source: "aeepr-feeders",
          filter: ["==", ["get", "kind"], "load_shed"],
          paint: {
            "fill-color": "#f59e0b",
            "fill-opacity": 0.28,
          },
        },
        "municipalities-outline",
      );
      map.addLayer(
        {
          id: "feeders-loadshed-stroke",
          type: "line",
          source: "aeepr-feeders",
          filter: ["==", ["get", "kind"], "load_shed"],
          paint: {
            "line-color": "#fde68a",
            "line-width": 1,
            "line-opacity": 0.85,
            "line-dasharray": [2, 2],
          },
        },
        "municipalities-outline",
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[GridMap] feeder outages failed", err);
      onMapErrorRef.current?.("AEE/PREPA feeder outages failed to load.");
    }
  }

  /**
   * Region-level outage overlay. Draws affected munis as red translucent
   * polygons when AEEPR feeders are empty (the common case). Honest about
   * granularity: each muni's tint reflects its REGION's count, not a per-
   * muni measurement.
   */
  async function loadMuniOutageOverlayInto(map: MlMap, showWhenLoaded: boolean) {
    try {
      const res = await fetch("/api/outages/muni-overlay", { cache: "no-store" });
      if (!res.ok) return;
      const fc = (await res.json()) as {
        type: "FeatureCollection";
        features: GeoJSON.Feature[];
        total_customers?: number;
      };
      if (!fc || !Array.isArray(fc.features)) return;
      const existing = map.getSource("muni-outage-overlay") as
        | maplibregl.GeoJSONSource
        | undefined;
      if (existing) {
        existing.setData(fc as GeoJSON.GeoJSON);
      } else {
        map.addSource("muni-outage-overlay", {
          type: "geojson",
          data: fc as GeoJSON.GeoJSON,
        });
        map.addLayer(
          {
            id: "muni-outage-overlay-fill",
            type: "fill",
            source: "muni-outage-overlay",
            paint: {
              "fill-color": "#ef4444",
              // Opacity scales with the region's customer count on a log
              // curve so a 30-customer event isn't invisible next to a
              // 10k-customer one.
              "fill-opacity": [
                "interpolate",
                ["linear"],
                [
                  "log10",
                  ["max", 1, ["get", "region_customers_out"]],
                ],
                1, 0.08,   // 10
                2, 0.18,   // 100
                3, 0.32,   // 1k
                4, 0.5,    // 10k+
              ],
            },
          },
          "municipalities-outline",
        );
        map.addLayer(
          {
            id: "muni-outage-overlay-stroke",
            type: "line",
            source: "muni-outage-overlay",
            paint: {
              "line-color": "#fecaca",
              "line-width": 0.8,
              "line-opacity": 0.7,
            },
          },
          "municipalities-outline",
        );
      }
      // Visibility tracks the outages-live toggle, but we only paint when
      // the AEEPR layer was empty — if AEEPR has data, those polygons are
      // strictly better and we hide the smear.
      const visible = showWhenLoaded && activeLayersRef.current.has("outages-live");
      const vis = visible ? "visible" : "none";
      if (map.getLayer("muni-outage-overlay-fill")) {
        map.setLayoutProperty("muni-outage-overlay-fill", "visibility", vis);
      }
      if (map.getLayer("muni-outage-overlay-stroke")) {
        map.setLayoutProperty("muni-outage-overlay-stroke", "visibility", vis);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[GridMap] muni outage overlay failed", err);
    }
  }

  async function loadPlannedWorkInto(map: MlMap) {
    try {
      const res = await fetch("/api/planned-work", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as {
        items: Array<{
          id: string;
          municipality_id: string | null;
          area: string | null;
          work_type: string | null;
          start_ts: string | null;
          end_ts: string | null;
          possible_interruption: boolean | null;
        }>;
      };
      // The API returns 100 most recent; filter to entries still in the
      // future (end_ts after now) so the map shows current/upcoming work.
      const now = Date.now();
      const items = (json.items ?? []).filter((i) => {
        const end = i.end_ts ? new Date(i.end_ts).getTime() : NaN;
        return !Number.isFinite(end) || end > now;
      });
      if (items.length === 0) {
        const src = map.getSource("planned-work") as
          | maplibregl.GeoJSONSource
          | undefined;
        if (src) src.setData({ type: "FeatureCollection", features: [] });
        return;
      }
      // Resolve muni centroids from the cached municipalities GeoJSON
      // (populated by addDataLayers) — never MapLibre's private internals.
      const data = cacheRef.current.munis;
      if (!data?.features) return;
      const centroidById = new Map<string, [number, number]>();
      for (const f of data.features) {
        const id = (f.properties as { id?: string } | null)?.id;
        if (!id) continue;
        const c = approxCentroid(f.geometry);
        if (c) centroidById.set(id, c);
      }
      const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
      for (const i of items) {
        const c = i.municipality_id ? centroidById.get(i.municipality_id) : null;
        if (!c) continue;
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: c },
          properties: {
            id: i.id,
            area: i.area ?? "",
            work_type: i.work_type ?? "",
            start_ts: i.start_ts ?? "",
            end_ts: i.end_ts ?? "",
            interruption: i.possible_interruption ? 1 : 0,
          },
        });
      }
      const fc: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };
      const existing = map.getSource("planned-work") as
        | maplibregl.GeoJSONSource
        | undefined;
      if (existing) {
        existing.setData(fc);
        return;
      }
      map.addSource("planned-work", { type: "geojson", data: fc });
      map.addLayer({
        id: "planned-work-halo",
        type: "circle",
        source: "planned-work",
        paint: {
          "circle-radius": [
            "case",
            ["==", ["get", "interruption"], 1], 16,
            12,
          ],
          "circle-color": "#fbbf24",
          "circle-opacity": 0.18,
          "circle-blur": 0.6,
        },
      });
      map.addLayer({
        id: "planned-work-dot",
        type: "circle",
        source: "planned-work",
        paint: {
          "circle-radius": 5,
          "circle-color": [
            "case",
            ["==", ["get", "interruption"], 1], "#f59e0b",
            "#fde68a",
          ],
          "circle-stroke-color": "#92400e",
          "circle-stroke-width": 1,
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[GridMap] planned-work load failed", err);
      onMapErrorRef.current?.("Planned work failed to load.");
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

    // Status fill — kept VERY subtle so the Protomaps land/water rendering
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
        // Dark mode needs a brighter stroke since the basemap is nearly black
        // and the previous slate-400 + 0.55 opacity dissolved into it.
        "line-color": themeRef.current === "dark" ? "#cbd5f5" : "#1e293b",
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          6, themeRef.current === "dark" ? 0.9 : 0.5,
          7, themeRef.current === "dark" ? 1.2 : 0.7,
          9, themeRef.current === "dark" ? 1.6 : 1.0,
          11, themeRef.current === "dark" ? 2.0 : 1.4,
        ],
        "line-opacity": [
          "case",
          ["boolean", ["feature-state", "hover"], false], 1,
          themeRef.current === "dark" ? 0.85 : 0.55,
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
        // Zoom-scaled so the 544 substations are visible at the default
        // zoom (~6.5) without clumping into one blob when zoomed in.
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          6, 3,
          8, 4.5,
          11, 6,
          14, 8,
        ],
        "circle-color": "#94a3b8",
        "circle-stroke-color": themeRef.current === "dark" ? "#0b1a33" : "#ffffff",
        "circle-stroke-width": 1.4,
        "circle-opacity": 0.92,
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

    // Show consolidated facilities (`kind: "plant"`) AND any named generator
    // node. PR's OSM coverage maps most large stations as named generators
    // (e.g. "Planta Hidroeléctrica de Río Blanco") rather than plant polygons,
    // so filtering on `plant` alone left the layer empty. Unnamed generator
    // nodes (the thousands of individual PV/turbine cells) are still dropped
    // to avoid fake clusters over solar farms.
    const PLANT_FILTER = [
      "all",
      ["any",
        ["==", ["get", "kind"], "plant"],
        ["==", ["get", "kind"], "generator"],
      ],
      ["has", "name"],
      ["!=", ["get", "name"], null],
      ["!=", ["get", "name"], ""],
    ] as unknown as maplibregl.ExpressionSpecification;

    map.addLayer({
      id: "osm-plants-glow",
      type: "circle",
      source: "osm-power",
      filter: PLANT_FILTER,
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
      filter: PLANT_FILTER,
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
      // MapLibre assigns numeric auto-ids (sometimes literal 0) to features
      // that lack their own id; `??` would let that through. Prefer the
      // string id when present, otherwise hand the API the plant name and
      // let it match by normalized name against plant_snapshots.
      const rawId = f.id;
      const idStr =
        typeof rawId === "string" && rawId.length > 0
          ? rawId
          : rawId != null && String(rawId) !== "0"
            ? String(rawId)
            : "";
      const name = typeof p.name === "string" ? p.name : "";
      const capRaw = p.capacity_mw;
      const capNum =
        typeof capRaw === "number"
          ? capRaw
          : typeof capRaw === "string"
            ? Number(capRaw)
            : null;
      onSelPlantRef.current?.(
        idStr || name || "plant",
        name || "Unnamed plant",
        (p.fuel as string | undefined) ?? undefined,
        capNum != null && Number.isFinite(capNum) ? capNum : null,
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
