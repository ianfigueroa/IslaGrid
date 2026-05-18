/**
 * LUMA's 7-region operating division → list of municipality ids (kebab-case
 * matching public/geo/pr-municipalities.geojson).
 *
 * Used by /api/outages/muni-overlay to color whole munis when feeder-level
 * outage data is empty — most of the time AEEPR's per-feeder feed sits empty
 * between pushes but LUMA still reports region-level customer counts, so we
 * smear the region count across its munis as a coarse fallback.
 *
 * Source: LUMA's published service-region map (cross-checked against
 * miluma.lumapr.com/outages/status which uses the same regions).
 */

export const LUMA_REGIONS = {
  "San Juan": ["san-juan"],
  "Bayamón": [
    "bayamon",
    "toa-alta",
    "toa-baja",
    "catano",
    "guaynabo",
    "comerio",
    "naranjito",
    "corozal",
    "vega-alta",
    "dorado",
  ],
  Carolina: [
    "carolina",
    "trujillo-alto",
    "loiza",
    "rio-grande",
    "canovanas",
    "luquillo",
    "fajardo",
    "ceiba",
    "vieques",
    "culebra",
  ],
  Caguas: [
    "caguas",
    "aguas-buenas",
    "san-lorenzo",
    "gurabo",
    "juncos",
    "las-piedras",
    "humacao",
    "naguabo",
    "yabucoa",
    "maunabo",
    "cidra",
    "cayey",
    "aibonito",
    "barranquitas",
  ],
  "Mayagüez": [
    "mayaguez",
    "hormigueros",
    "san-german",
    "cabo-rojo",
    "lajas",
    "sabana-grande",
    "maricao",
    "las-marias",
    "anasco",
    "rincon",
    "aguada",
    "aguadilla",
    "moca",
    "san-sebastian",
  ],
  Ponce: [
    "ponce",
    "adjuntas",
    "jayuya",
    "juana-diaz",
    "santa-isabel",
    "coamo",
    "salinas",
    "villalba",
    "guayanilla",
    "penuelas",
    "yauco",
    "guanica",
  ],
  Arecibo: [
    "arecibo",
    "camuy",
    "quebradillas",
    "isabela",
    "lares",
    "utuado",
    "hatillo",
    "manati",
    "vega-baja",
    "florida",
    "ciales",
    "barceloneta",
    "morovis",
    "orocovis",
  ],
} as const satisfies Record<string, readonly string[]>;

export type LumaRegion = keyof typeof LUMA_REGIONS;

/** Inverse map: muni id → region name. */
export const MUNI_TO_REGION: Record<string, LumaRegion> = (() => {
  const out: Record<string, LumaRegion> = {};
  for (const [region, munis] of Object.entries(LUMA_REGIONS) as Array<
    [LumaRegion, readonly string[]]
  >) {
    for (const muniId of munis) out[muniId] = region;
  }
  return out;
})();

/** Strip accents + lowercase so "Bayamon" matches "Bayamón". */
export function normalizeRegionName(s: string | null | undefined): LumaRegion | null {
  if (!s) return null;
  const cleaned = s.replace(/^T&D\s+/i, "").trim();
  const strip = (v: string) =>
    v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  for (const region of Object.keys(LUMA_REGIONS) as LumaRegion[]) {
    if (strip(region) === strip(cleaned)) return region;
  }
  return null;
}
