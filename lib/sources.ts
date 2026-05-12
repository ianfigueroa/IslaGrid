/**
 * Source labels — every public number must carry one.
 * See docs/DATA_SOURCES.md for the master list.
 */

export type SourceLabel = "official" | "estimated" | "community" | "unverified";

export type SourceId =
  | "datos.pr.gov"
  | "lumapr.com"
  | "lumapr.com/bps"
  | "lumapr.com/planned-work"
  | "lumapr.com/avisos"
  | "genera-pr.com"
  | "aeepr.maps.arcgis.com"
  | "api.weather.gov"
  | "openstreetmap"
  | "tiger-2024"
  | "nrel-pvrdb"
  | "preb"
  | "preb-seed"
  | "social.x.unverified"
  | "islagrid-heuristic"
  | "islagrid-model";

export interface SourceMeta {
  label: SourceLabel;
  display: string;
  url?: string;
  /** Maximum acceptable age in seconds before UI shows a "stale" chip */
  freshnessSlo: number;
}

export const SOURCES: Record<SourceId, SourceMeta> = {
  "datos.pr.gov": {
    label: "official",
    display: "datos.pr.gov",
    url: "https://datos.pr.gov",
    freshnessSlo: 600,
  },
  "lumapr.com": {
    label: "official",
    display: "LUMA",
    url: "https://lumapr.com/resumen-del-sistema/",
    freshnessSlo: 1800,
  },
  "lumapr.com/bps": {
    label: "official",
    display: "LUMA BPS",
    url: "https://lumapr.com/bps-monitoring/",
    freshnessSlo: 129600, // 36h
  },
  "lumapr.com/planned-work": {
    label: "official",
    display: "LUMA Planned Work",
    url: "https://lumapr.com/mejorasplanificadas/",
    freshnessSlo: 86400, // 24h
  },
  "lumapr.com/avisos": {
    label: "official",
    display: "LUMA Avisos",
    url: "https://lumapr.com/avisos/",
    freshnessSlo: 21600, // 6h
  },
  "genera-pr.com": {
    label: "official",
    display: "Genera PR",
    url: "https://genera-pr.com/data-generacion",
    freshnessSlo: 1800,
  },
  "aeepr.maps.arcgis.com": {
    label: "official",
    display: "AEE / PREPA",
    url: "https://aeepr.maps.arcgis.com",
    freshnessSlo: 1800,
  },
  "api.weather.gov": {
    label: "official",
    display: "NWS",
    url: "https://www.weather.gov",
    freshnessSlo: 3600,
  },
  openstreetmap: {
    label: "community",
    display: "OpenStreetMap",
    url: "https://www.openstreetmap.org/copyright",
    freshnessSlo: 604800,
  },
  "tiger-2024": {
    label: "official",
    display: "Census TIGER",
    freshnessSlo: 31536000,
  },
  "nrel-pvrdb": {
    label: "official",
    display: "NREL PVRDB (LiDAR 2015–2017)",
    url: "https://data.openei.org/submissions/2862",
    freshnessSlo: 31536000 * 10,
  },
  preb: {
    label: "official",
    display: "PREB",
    url: "https://energia.pr.gov",
    freshnessSlo: 31536000,
  },
  "preb-seed": {
    label: "estimated",
    display: "PREB seed (frozen 2026 Q1)",
    url: "https://energia.pr.gov/en/current-rate/",
    // 90 days. PREB issues quarterly fuel/purchased-power adjustments so the
    // seed will fall behind reality within a quarter; UI should mark it
    // "stale" rather than silently presenting year-old rates as current.
    freshnessSlo: 60 * 60 * 24 * 90,
  },
  "social.x.unverified": {
    label: "unverified",
    display: "X / Twitter (unverified)",
    url: "https://x.com/LUMAEnergyPR",
    freshnessSlo: 3600, // 1h
  },
  "islagrid-heuristic": {
    label: "estimated",
    display: "IslaGrid heuristic",
    freshnessSlo: 0,
  },
  "islagrid-model": {
    label: "estimated",
    display: "IslaGrid model prediction",
    freshnessSlo: 1800, // 30 min
  },
};

export function freshnessState(
  source: SourceId,
  asOfIso: string,
): "fresh" | "stale" | "very_stale" {
  const meta = SOURCES[source];
  const ageSec = (Date.now() - new Date(asOfIso).getTime()) / 1000;
  if (ageSec < meta.freshnessSlo) return "fresh";
  if (ageSec < meta.freshnessSlo * 3) return "stale";
  return "very_stale";
}

export function formatAge(asOfIso: string): string {
  const ageSec = Math.max(0, (Date.now() - new Date(asOfIso).getTime()) / 1000);
  if (ageSec < 60) return `${Math.round(ageSec)}s ago`;
  if (ageSec < 3600) return `${Math.round(ageSec / 60)}m ago`;
  if (ageSec < 86400) return `${Math.round(ageSec / 3600)}h ago`;
  return `${Math.round(ageSec / 86400)}d ago`;
}
