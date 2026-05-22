/**
 * MapLibre basemap/style construction. Extracted from GridMap.tsx so the
 * map orchestrator stays focused on lifecycle and data layers.
 *
 * Two sources of basemap: Protomaps PMTiles (light/dark, default) and Esri
 * World Imagery (satellite, only when the user picks it from BrandPill).
 * Protomaps tiles ship with the app at /map/pr.pmtiles; the PMTiles
 * protocol is registered once per page load.
 */

import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import { layers as protomapsLayers, namedFlavor } from "@protomaps/basemaps";

export type Basemap = "light" | "dark" | "satellite";

// Register the pmtiles:// protocol with MapLibre once per page load. Calling
// this twice is harmless — addProtocol replaces the previous handler — but
// guarding keeps the console clean during HMR.
let _pmtilesRegistered = false;
export function ensurePmtilesProtocol(): void {
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

export function styleFor(basemap: Basemap): maplibregl.StyleSpecification {
  if (basemap === "satellite") return satelliteStyle();
  return protomapsStyle(basemap === "dark" ? "dark" : "light");
}
