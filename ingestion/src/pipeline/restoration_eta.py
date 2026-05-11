"""
Phase 10 — heuristic restoration-ETA predictor.

The goal is an honest *range*, not a point estimate. Inputs:
  - age of the outage event (longer = wider tail)
  - severity proxy from latest weather snapshot in the municipality
  - count of planned-work items in the muni window (high planned-work density
    correlates with longer restorations)
  - historical median restoration time for the muni from `outage_events` that
    have an `ended_at`.

Every prediction stores its `model_version`, the numeric bounds, and a
human-readable `reasons` array so the UI can explain *why*.
"""

from __future__ import annotations

import logging
import statistics
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable

from .supabase_client import supabase

MODEL_VERSION = "heuristic:eta-v1-20260511"

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Prediction:
    outage_event_id: str
    low_hours: float
    high_hours: float
    confidence: str  # 'low' | 'medium' | 'high'
    reasons: list[str]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _historical_median_hours(muni_id: str | None) -> float | None:
    if not muni_id:
        return None
    rows = (
        supabase()
        .table("outage_events")
        .select("started_at, ended_at")
        .eq("municipality_id", muni_id)
        .not_.is_("ended_at", "null")
        .order("started_at", desc=True)
        .limit(50)
        .execute()
        .data
        or []
    )
    durations: list[float] = []
    for row in rows:
        start = _parse_ts(row.get("started_at"))
        end = _parse_ts(row.get("ended_at"))
        if not start or not end:
            continue
        diff = (end - start).total_seconds() / 3600
        if 0 < diff < 96:
            durations.append(diff)
    if not durations:
        return None
    return statistics.median(durations)


def _weather_severity(muni_id: str | None) -> tuple[float, str | None]:
    """Returns (severity 0..1, reason or None)."""
    if not muni_id:
        return 0.0, None
    row = (
        supabase()
        .table("weather_snapshots")
        .select("ts, wind_kph, gust_kph, precip_mm, prob_precip, alert_level")
        .eq("municipality_id", muni_id)
        .order("ts", desc=True)
        .limit(1)
        .maybeSingle()
        .execute()
        .data
    )
    if not row:
        return 0.0, None
    wind = float(row.get("gust_kph") or row.get("wind_kph") or 0)
    precip = float(row.get("precip_mm") or 0)
    alert = (row.get("alert_level") or "").lower()
    severity = 0.0
    reasons: list[str] = []
    if "warning" in alert or "severe" in alert:
        severity = max(severity, 0.9)
        reasons.append("Active NWS warning")
    if wind >= 70:
        severity = max(severity, 0.85)
        reasons.append(f"Sustained gusts {wind:.0f} kph")
    elif wind >= 45:
        severity = max(severity, 0.5)
    if precip >= 30:
        severity = max(severity, 0.55)
        reasons.append(f"Heavy rain {precip:.0f} mm/h")
    return severity, (reasons[0] if reasons else None)


def _planned_work_proximity(muni_id: str | None) -> int:
    if not muni_id:
        return 0
    res = (
        supabase()
        .table("planned_work")
        .select("id", count="exact", head=True)
        .eq("municipality_id", muni_id)
        .gte("end_ts", _now().isoformat())
        .execute()
    )
    return int(res.count or 0)


def _classify(
    age_hours: float,
    weather_severity: float,
    planned_count: int,
    historical_median: float | None,
) -> tuple[float, float, str, list[str]]:
    """
    Return (low, high, confidence, reasons).

    The shape: start with historical median (or 3h default), widen for weather
    and planned-work proximity, never claim sub-hour precision.
    """
    reasons: list[str] = []
    center = historical_median if historical_median is not None else 3.0
    if historical_median is not None:
        reasons.append(f"Local median historic restoration ~{historical_median:.0f}h")
    else:
        reasons.append("No local history — using island default of ~3h")

    # Weather widens the upper bound.
    weather_bump = weather_severity * 6.0
    if weather_severity > 0.4:
        reasons.append("Weather is severe enough to delay crews")

    # Planned-work density slightly compresses the lower bound (cluster of work
    # often means crews already on the ground).
    planned_adj = min(planned_count * 0.3, 1.5)
    if planned_count >= 2:
        reasons.append(f"{planned_count} planned-work items nearby")

    # If the outage has already been open for X hours and isn't restored, the
    # remaining tail almost certainly extends past 1.5x age.
    age_bump = max(0.0, age_hours - center) * 0.5
    if age_hours > center * 1.5:
        reasons.append(
            f"Already open {age_hours:.0f}h — restoration likely longer than typical"
        )

    low = max(0.5, center - planned_adj)
    high = max(low + 1.0, center + weather_bump + age_bump + 1.0)
    # Round to halves so the UI never shows fake precision like "2.34 hours".
    low = round(low * 2) / 2
    high = round(high * 2) / 2

    if (
        historical_median is not None
        and weather_severity < 0.3
        and planned_count <= 1
    ):
        confidence = "high"
    elif weather_severity >= 0.7 or historical_median is None:
        confidence = "low"
    else:
        confidence = "medium"

    return low, high, confidence, reasons


def predict_for_event(event: dict[str, Any]) -> Prediction | None:
    eid = event.get("id")
    if not eid:
        return None
    started = _parse_ts(event.get("started_at"))
    if not started:
        return None
    age_hours = max(0.0, (_now() - started).total_seconds() / 3600)
    muni_id = event.get("municipality_id")
    historical = _historical_median_hours(muni_id)
    severity, _weather_reason = _weather_severity(muni_id)
    planned = _planned_work_proximity(muni_id)
    low, high, conf, reasons = _classify(age_hours, severity, planned, historical)
    return Prediction(
        outage_event_id=str(eid),
        low_hours=low,
        high_hours=high,
        confidence=conf,
        reasons=reasons,
    )


def _upsert(predictions: Iterable[Prediction]) -> int:
    payload = [
        {
            "outage_event_id": p.outage_event_id,
            "ts": _now().isoformat(),
            "low_hours": p.low_hours,
            "high_hours": p.high_hours,
            "confidence": p.confidence,
            "model_version": MODEL_VERSION,
            "reasons": p.reasons,
        }
        for p in predictions
    ]
    if not payload:
        return 0
    supabase().table("restoration_eta_predictions").upsert(
        payload, on_conflict="outage_event_id"
    ).execute()
    return len(payload)


def run() -> int:
    rows = (
        supabase()
        .table("outage_events")
        .select("id, municipality_id, started_at, ended_at, kind, snippet")
        .is_("ended_at", "null")
        .in_("kind", ["unplanned", "unknown"])
        .order("started_at", desc=True)
        .limit(200)
        .execute()
        .data
        or []
    )
    predictions: list[Prediction] = []
    for row in rows:
        pred = predict_for_event(row)
        if pred:
            predictions.append(pred)
    written = _upsert(predictions)
    log.info("restoration_eta: wrote %d predictions over %d open events", written, len(rows))
    return written


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    sys.exit(0 if run() >= 0 else 1)
