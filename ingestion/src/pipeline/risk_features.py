"""
Per-municipality risk feature builder.

Pulls the latest weather, grid, and planned-work rows and emits one feature
dict per municipality, then runs the heuristic classifier in `risk.py` to
score each one. Output rows land in `municipality_risk_snapshots`.

This is the Phase 7 deliverable and also the staging ground for Phase 9 ML
training: every column produced here is a candidate model feature.
"""

from __future__ import annotations

import logging
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from .risk import GridInputs, classify
from .supabase_client import supabase

log = logging.getLogger(__name__)

ALERT_WEIGHT = {"none": 0.0, "advisory": 0.25, "watch": 0.6, "warning": 1.0}


@dataclass
class MunicipalityFeatures:
    municipality_id: str
    weather_risk: float = 0.0          # 0..1
    grid_stress: float = 0.0           # 0..1, derived from island-wide grid snapshot
    planned_work_active: bool = False
    historical_outage_density: float = 0.0  # 0..1; placeholder until Phase 9
    feature_freshness_s: int = 0
    reasons: list[str] = field(default_factory=list)
    # Hurricane features (None when no active storm).
    forecast_cone_coverage_pct: float | None = None
    nearest_storm_category: int | None = None
    nearest_storm_id: str | None = None


# Model identity for downstream consumers. Bump when the heuristic changes.
HEURISTIC_VERSION = "heuristic-v2-20260512"


def _point_in_polygon(lon: float, lat: float, ring: list[list[float]]) -> bool:
    """Ray-casting; ring is a list of [lon, lat] pairs, closed or not."""
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        intersect = ((yi > lat) != (yj > lat)) and (
            lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi
        )
        if intersect:
            inside = not inside
        j = i
    return inside


def _hurricane_features(
    cones: list[dict[str, Any]],
    centroid_lon: float | None,
    centroid_lat: float | None,
) -> tuple[float | None, int | None, str | None]:
    """Return (cone_coverage_pct, max_category, storm_id) for a muni centroid.

    cone_coverage_pct is a coarse 0/1 indicator (100 if inside any cone, else
    0). Higher-resolution coverage requires polygon intersection which we'll
    add when we have geopandas at runtime — for now binary containment is
    enough to drive the heuristic.
    """
    if centroid_lon is None or centroid_lat is None or not cones:
        return None, None, None
    best_cat: int | None = None
    best_id: str | None = None
    coverage = 0.0
    for storm in cones:
        cone = storm.get("cone_geojson")
        if not cone or cone.get("type") != "Polygon":
            continue
        rings = cone.get("coordinates") or []
        if not rings:
            continue
        outer = rings[0]
        if _point_in_polygon(centroid_lon, centroid_lat, outer):
            coverage = 100.0
            cat = storm.get("category")
            if cat is not None and (best_cat is None or cat > best_cat):
                best_cat = cat
                best_id = storm.get("storm_id")
    return (coverage if coverage > 0 else 0.0, best_cat, best_id)


def _weather_risk(wind_kph: float | None, gust_kph: float | None, precip_mm: float | None,
                  prob_precip: float | None, alert_level: str | None) -> float:
    """Combine NWS fields into a single 0..1 risk index."""
    parts = []
    if wind_kph is not None:
        parts.append(min(1.0, wind_kph / 80.0))
    if gust_kph is not None:
        parts.append(min(1.0, gust_kph / 100.0))
    if precip_mm is not None:
        parts.append(min(1.0, precip_mm / 30.0))
    if prob_precip is not None:
        # NWS sometimes returns probabilities as 0..100.
        p = prob_precip / 100 if prob_precip > 1 else prob_precip
        parts.append(min(1.0, max(0.0, p)))
    base = max(parts) if parts else 0.0
    return min(1.0, base + ALERT_WEIGHT.get(alert_level or "none", 0.0))


def _grid_stress(grid_row: dict[str, Any] | None) -> float:
    if not grid_row:
        return 0.0
    if grid_row.get("source_stale"):
        return 0.3  # we don't know; assume modest stress
    status = grid_row.get("status")
    return {"normal": 0.05, "watch": 0.35, "strained": 0.7, "critical": 1.0, "stale": 0.3, "unknown": 0.2}.get(status, 0.2)


def _score(features: MunicipalityFeatures) -> tuple[float, str, list[str]]:
    """Combine features into a 0..100 score, a band, and human-readable reasons."""
    reasons = list(features.reasons)
    # Hurricane lift: any muni inside an active cone gets a strong prior. A
    # cat-3+ storm pushes the risk into the severe band on its own.
    hurricane_bump = 0.0
    if features.forecast_cone_coverage_pct and features.forecast_cone_coverage_pct > 0:
        cat = features.nearest_storm_category or 0
        if cat >= 3:
            hurricane_bump = 0.6
        elif cat >= 1:
            hurricane_bump = 0.4
        elif cat == 0:
            hurricane_bump = 0.25
        else:
            hurricane_bump = 0.15
        reasons.append(
            f"Inside active hurricane cone ({features.nearest_storm_id or 'unknown'}, cat {cat})"
        )

    raw = (
        0.50 * features.weather_risk
        + 0.30 * features.grid_stress
        + 0.15 * (1.0 if features.planned_work_active else 0.0)
        + 0.05 * features.historical_outage_density
        + hurricane_bump
    )
    score = round(min(100.0, raw * 100.0), 1)

    if features.weather_risk >= 0.6:
        reasons.append("Severe weather forecast or active alert")
    elif features.weather_risk >= 0.3:
        reasons.append("Weather is elevating risk")
    if features.grid_stress >= 0.6:
        reasons.append("Island grid is strained or critical")
    elif features.grid_stress >= 0.3:
        reasons.append("Reserves are thinner than usual")
    if features.planned_work_active:
        reasons.append("Planned work scheduled near this area")
    if features.historical_outage_density >= 0.3:
        reasons.append("Repeated outage history in this area")

    if score < 25:
        band = "low"
    elif score < 50:
        band = "elevated"
    elif score < 75:
        band = "high"
    else:
        band = "severe"
    return score, band, reasons


def build_for(municipality_id: str, weather: dict[str, Any] | None,
              grid_row: dict[str, Any] | None, planned_active: bool) -> MunicipalityFeatures:
    f = MunicipalityFeatures(municipality_id=municipality_id)
    if weather is None:
        f.reasons.append("No weather data available")
        f.weather_risk = 0.0
    else:
        f.weather_risk = _weather_risk(
            weather.get("wind_kph"),
            weather.get("gust_kph"),
            weather.get("precip_mm"),
            weather.get("prob_precip"),
            weather.get("alert_level"),
        )
    f.grid_stress = _grid_stress(grid_row)
    f.planned_work_active = planned_active
    return f


def _heuristic_ci(score: float, freshness_s: int, weather_present: bool) -> tuple[float, float]:
    """Honest CI for the rule-based score.

    Width grows with feature staleness and shrinks when we have weather data.
    No statistical guarantee — this is "the rule can be wrong by about this
    much" telegraphed to users. Replace with quantile CIs once XGBoost ships.
    """
    base_width = 8.0  # +/- on a 0..100 scale
    if not weather_present:
        base_width += 10.0
    if freshness_s > 3600:
        base_width += 5.0
    if freshness_s > 21600:
        base_width += 10.0
    lo = max(0.0, score - base_width)
    hi = min(100.0, score + base_width)
    return round(lo, 1), round(hi, 1)


def run() -> int:
    sb = supabase()
    # Pull the freshest weather row per municipality (≤ 6 h old) and the
    # newest grid_snapshot, and any planned_work window currently active.
    now = datetime.now(timezone.utc)

    weather_rows = (
        sb.table("weather_snapshots")
        .select("ts, municipality_id, wind_kph, gust_kph, precip_mm, prob_precip, alert_level")
        .order("ts", desc=True)
        .limit(1000)
        .execute()
        .data
    )
    latest_weather: dict[str, dict[str, Any]] = {}
    for row in weather_rows or []:
        latest_weather.setdefault(row["municipality_id"], row)

    grid_row = (
        sb.table("grid_snapshots")
        .select("status, source_stale, ts")
        .order("ts", desc=True)
        .limit(1)
        .execute()
        .data
    )
    grid = grid_row[0] if grid_row else None

    planned_rows = (
        sb.table("planned_work")
        .select("municipality_id, start_ts, end_ts")
        .execute()
        .data
    ) or []
    planned_active: set[str] = set()
    for row in planned_rows:
        if not row.get("municipality_id"):
            continue
        planned_active.add(row["municipality_id"])

    # Active hurricane cones (latest forecast per storm).
    try:
        cones = (
            sb.table("hurricane_active_latest")
            .select("storm_id, category, cone_geojson")
            .execute()
            .data
        ) or []
    except Exception as exc:  # noqa: BLE001
        log.warning("hurricane_active_latest unavailable (%s) — skipping cone features", exc)
        cones = []

    # Municipality centroids for cone containment.
    muni_centroids: dict[str, tuple[float, float]] = {}
    muni_rows = (
        sb.table("municipalities")
        .select("id, centroid_lon, centroid_lat")
        .execute()
        .data
    ) or []
    for r in muni_rows:
        if r.get("centroid_lon") is not None and r.get("centroid_lat") is not None:
            muni_centroids[r["id"]] = (float(r["centroid_lon"]), float(r["centroid_lat"]))

    muni_ids = list({*latest_weather.keys(), *planned_active, *muni_centroids.keys()})

    rows = []
    for muni_id in muni_ids:
        weather = latest_weather.get(muni_id)
        f = build_for(muni_id, weather, grid, muni_id in planned_active)
        cen = muni_centroids.get(muni_id)
        if cen and cones:
            cov, cat, sid = _hurricane_features(cones, cen[0], cen[1])
            f.forecast_cone_coverage_pct = cov
            f.nearest_storm_category = cat
            f.nearest_storm_id = sid
        score, band, reasons = _score(f)
        freshness = int(
            (now - datetime.fromisoformat(weather["ts"].replace("Z", "+00:00"))).total_seconds()
        ) if weather else 0
        ci_low, ci_high = _heuristic_ci(score, freshness, weather is not None)
        rows.append(
            {
                "ts": now.isoformat(),
                "municipality_id": muni_id,
                "risk_score": score,
                "band": band,
                "reasons": reasons,
                "feature_freshness_s": freshness,
                "source": "islagrid-heuristic",
                "model_version": HEURISTIC_VERSION,
                "ci_low": ci_low,
                "ci_high": ci_high,
                "forecast_cone_coverage_pct": f.forecast_cone_coverage_pct,
                "nearest_storm_category": f.nearest_storm_category,
                "nearest_storm_id": f.nearest_storm_id,
            }
        )

    if rows:
        sb.table("municipality_risk_snapshots").upsert(
            rows, on_conflict="ts,municipality_id"
        ).execute()
    # Also emit one classic island-wide row to keep the existing /api/grid/status pipeline honest.
    if grid is not None:
        island = classify(GridInputs(source_stale=bool(grid.get("source_stale"))))
        log.info(
            "Island-wide heuristic: %s (per-municipality rows written: %d)",
            island.status,
            len(rows),
        )
    return len(rows)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    sys.exit(0 if run() >= 0 else 1)
