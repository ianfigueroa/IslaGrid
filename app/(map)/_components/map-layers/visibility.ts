/**
 * Single source of truth for which MapLibre layer IDs are visible per
 * `ActiveLayerKey`. Pulled out of GridMap.tsx so the visibility map can be
 * audited / unit-tested without spinning up the whole map.
 *
 * Behavior notes baked into the rules (preserved verbatim from the
 * original):
 *
 * - Risk + demand both override the municipality status fill; demand only
 *   wins when risk isn't active so the rail order maps to a clear priority.
 * - AEE/PREPA feeder outages ride along with the "outages-live" toggle. The
 *   muni-overlay smear (LUMA region totals) also rides this toggle but its
 *   loader decides whether to actually show it; the off-branch here covers
 *   the user toggling the pill back off.
 */

import type { Map as MlMap } from "maplibre-gl";

export type ActiveLayerKey =
  | "municipalities"
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

export function applyLayerVisibility(map: MlMap, activeLayers: Set<ActiveLayerKey>): void {
  const showMuni = activeLayers.has("municipalities");
  const showRisk = activeLayers.has("outage-risk");
  const showDemand = activeLayers.has("demand");
  const showPlants =
    activeLayers.has("generation") || activeLayers.has("infrastructure");
  const showSubs = activeLayers.has("infrastructure");
  const showReports = activeLayers.has("reports");

  const setVis = (id: string, visible: boolean) => {
    if (!map.getLayer(id)) return;
    map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  };
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
