/**
 * Resolve lat/lon → municipality id by point-in-polygon against the
 * pre-loaded PR municipalities geojson. Loaded once and cached for the life
 * of the server process.
 *
 * Used at community-report insert time so the row carries a
 * `municipality_id` and per-muni aggregation doesn't need a spatial join.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

interface MuniFeature {
  id: string;
  rings: number[][][]; // [polygon][ring][point: [lng, lat]]
}

let cache: MuniFeature[] | null = null;

async function loadOnce(): Promise<MuniFeature[]> {
  if (cache) return cache;
  const file = path.join(
    process.cwd(),
    "public",
    "geo",
    "pr-municipalities.geojson",
  );
  const raw = await fs.readFile(file, "utf8");
  const fc = JSON.parse(raw) as {
    features: Array<{
      properties: { id: string };
      geometry:
        | { type: "Polygon"; coordinates: number[][][] }
        | { type: "MultiPolygon"; coordinates: number[][][][] };
    }>;
  };
  cache = fc.features.map((f) => {
    if (f.geometry.type === "Polygon") {
      return { id: f.properties.id, rings: [f.geometry.coordinates[0]] };
    }
    return {
      id: f.properties.id,
      rings: f.geometry.coordinates.map((poly) => poly[0]),
    };
  });
  return cache;
}

/** Ray-casting point-in-polygon. Returns true when (lng,lat) is inside. */
function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export async function locateMunicipality(
  lat: number,
  lon: number,
): Promise<string | null> {
  const features = await loadOnce();
  for (const feature of features) {
    for (const ring of feature.rings) {
      if (pointInRing(lon, lat, ring)) return feature.id;
    }
  }
  return null;
}
