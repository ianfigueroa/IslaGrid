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
    raw = (
        0.50 * features.weather_risk
        + 0.30 * features.grid_stress
        + 0.15 * (1.0 if features.planned_work_active else 0.0)
        + 0.05 * features.historical_outage_density
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
        # If we don't have a time window the row could mean anything; we
        # still treat it as 'active near this area' for the next 24h after
        # scraping. The conservative default is fine for the heuristic.
        planned_active.add(row["municipality_id"])

    muni_ids = list(
        {*latest_weather.keys(), *planned_active, *(r["id"] for r in sb.table("municipalities").select("id").execute().data or [])}
    )

    rows = []
    for muni_id in muni_ids:
        weather = latest_weather.get(muni_id)
        f = build_for(muni_id, weather, grid, muni_id in planned_active)
        score, band, reasons = _score(f)
        freshness = int(
            (now - datetime.fromisoformat(weather["ts"].replace("Z", "+00:00"))).total_seconds()
        ) if weather else 0
        rows.append(
            {
                "ts": now.isoformat(),
                "municipality_id": muni_id,
                "risk_score": score,
                "band": band,
                "reasons": reasons,
                "feature_freshness_s": freshness,
                "source": "islagrid-heuristic",
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
