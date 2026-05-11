// One-off script: convert Overpass JSON (admin_level=6 relations for PR)
// into a simplified GeoJSON FeatureCollection ready for MapLibre.
//
// Usage:
//   node scripts/build-municipalities.mjs <input> <output>
//
// Input must be the JSON response from Overpass `out geom` for the 78 PR
// municipality relations.

import fs from "node:fs";

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("Usage: node build-municipalities.mjs <input.json> <output.geojson>");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(inPath, "utf8"));

// Build a Polygon/MultiPolygon from a relation's outer ways.
function buildPolygon(relation) {
  const outers = relation.members.filter(
    (m) => m.type === "way" && m.role === "outer" && Array.isArray(m.geometry),
  );
  const inners = relation.members.filter(
    (m) => m.type === "way" && m.role === "inner" && Array.isArray(m.geometry),
  );
  if (outers.length === 0) return null;

  // Each way is a sequence of {lat, lon}. Stitch ways into closed rings.
  const stitch = (ways) => {
    const segments = ways.map((w) =>
      w.geometry.map((pt) => [round(pt.lon), round(pt.lat)]),
    );
    const rings = [];
    while (segments.length > 0) {
      const ring = segments.shift().slice();
      let progress = true;
      while (progress && !ringClosed(ring)) {
        progress = false;
        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i];
          if (pointEq(ring[ring.length - 1], seg[0])) {
            ring.push(...seg.slice(1));
            segments.splice(i, 1);
            progress = true;
            break;
          }
          if (pointEq(ring[ring.length - 1], seg[seg.length - 1])) {
            ring.push(...seg.slice(0, -1).reverse());
            segments.splice(i, 1);
            progress = true;
            break;
          }
          if (pointEq(ring[0], seg[seg.length - 1])) {
            ring.unshift(...seg.slice(0, -1));
            segments.splice(i, 1);
            progress = true;
            break;
          }
          if (pointEq(ring[0], seg[0])) {
            ring.unshift(...seg.slice(1).reverse());
            segments.splice(i, 1);
            progress = true;
            break;
          }
        }
      }
      if (!pointEq(ring[0], ring[ring.length - 1])) ring.push(ring[0]);
      rings.push(ring);
    }
    return rings;
  };

  const outerRings = stitch(outers);
  const innerRings = stitch(inners);

  // Pair each inner ring with the outer ring containing it.
  const polygons = outerRings.map((r) => [r]);
  for (const inner of innerRings) {
    const host = polygons.findIndex((p) => pointInRing(inner[0], p[0]));
    if (host >= 0) polygons[host].push(inner);
  }

  if (polygons.length === 1) {
    return { type: "Polygon", coordinates: polygons[0] };
  }
  return { type: "MultiPolygon", coordinates: polygons };
}

function round(n) { return Math.round(n * 1e5) / 1e5; }
function pointEq(a, b) { return a[0] === b[0] && a[1] === b[1]; }
function ringClosed(r) { return r.length > 2 && pointEq(r[0], r[r.length - 1]); }
function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Ramer–Douglas–Peucker for ring simplification.
function rdp(points, tolerance) {
  if (points.length < 3) return points;
  let maxDist = 0, idx = 0;
  const [start, end] = [points[0], points[points.length - 1]];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], start, end);
    if (d > maxDist) { maxDist = d; idx = i; }
  }
  if (maxDist > tolerance) {
    const left = rdp(points.slice(0, idx + 1), tolerance);
    const right = rdp(points.slice(idx), tolerance);
    return left.slice(0, -1).concat(right);
  }
  return [start, end];
}
function perpDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx === 0 && dy === 0) {
    const ddx = p[0] - a[0], ddy = p[1] - a[1];
    return Math.sqrt(ddx * ddx + ddy * ddy);
  }
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const tc = Math.max(0, Math.min(1, t));
  const fx = a[0] + tc * dx, fy = a[1] + tc * dy;
  const ddx = p[0] - fx, ddy = p[1] - fy;
  return Math.sqrt(ddx * ddx + ddy * ddy);
}

function simplifyGeometry(geom, tol) {
  const simplifyRing = (ring) => {
    const r = rdp(ring, tol);
    if (!pointEq(r[0], r[r.length - 1])) r.push(r[0]);
    return r.length >= 4 ? r : ring;
  };
  if (geom.type === "Polygon") {
    return { type: "Polygon", coordinates: geom.coordinates.map(simplifyRing) };
  }
  if (geom.type === "MultiPolygon") {
    return {
      type: "MultiPolygon",
      coordinates: geom.coordinates.map((poly) => poly.map(simplifyRing)),
    };
  }
  return geom;
}

const features = [];
let skipped = 0;
for (const el of data.elements) {
  if (el.type !== "relation") continue;
  const name = el.tags?.name;
  const fips = el.tags?.["nist:fips_code"] || el.tags?.["ref:fips"];
  if (!name) continue;
  const geom = buildPolygon(el);
  if (!geom) { skipped++; continue; }
  const simplified = simplifyGeometry(geom, 0.0012);
  features.push({
    type: "Feature",
    id: fips || `osm:${el.id}`,
    properties: {
      id: fips || `osm:${el.id}`,
      name,
      fips,
      population: el.tags.population ? Number(el.tags.population) : null,
    },
    geometry: simplified,
  });
}

const fc = { type: "FeatureCollection", features };
fs.writeFileSync(outPath, JSON.stringify(fc));
console.log(`Wrote ${features.length} municipalities (skipped ${skipped}) -> ${outPath}`);
console.log(`Size: ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB`);
