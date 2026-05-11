import { latLngToCell, cellToBoundary, cellToLatLng } from "h3-js";

/** Resolution chosen for community-report aggregation. Res-7 is ~5 km² per cell. */
export const REPORT_RESOLUTION = 7;

export function pointToCell(lat: number, lng: number, res = REPORT_RESOLUTION): string {
  return latLngToCell(lat, lng, res);
}

export function cellToGeoJson(h3: string): GeoJSON.Polygon {
  const boundary = cellToBoundary(h3, true); // [lng, lat]
  return {
    type: "Polygon",
    coordinates: [boundary],
  };
}

export function cellCentroid(h3: string): [number, number] {
  const [lat, lng] = cellToLatLng(h3);
  return [lng, lat];
}
