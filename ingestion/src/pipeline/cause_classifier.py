"""
Phase 10 — heuristic cause classifier for open outage events.

Buckets a row into one of eight causes from a mix of:
  - regex over the source snippet + related official_updates
  - weather conditions at outage start (high wind/rain → weather)
  - presence of overlapping planned_work (planned_maintenance)
  - grid-stress level at outage start (low reserves → generation_shortage)

Confidence is conservative: when two signals conflict we say `unknown` rather
than guess.
"""

from __future__ import annotations

import logging
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable

from .supabase_client import supabase

MODEL_VERSION = "heuristic:cause-v1-20260511"

log = logging.getLogger(__name__)

PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("vegetation",  re.compile(r"\b(tree|árbol|arbol|vegetac|rama|branch)\b", re.IGNORECASE)),
    ("equipment",   re.compile(r"\b(transformer|transformador|fuse|fusible|switch|interruptor|breaker)\b", re.IGNORECASE)),
    ("transmission",re.compile(r"\b(transmission|transmisión|transmision|línea de 230|115\s*kV|230\s*kV)\b", re.IGNORECASE)),
    ("distribution",re.compile(r"\b(pole|poste|conductor|aislador|insulator|feeder|alimentador)\b", re.IGNORECASE)),
    ("planned_maintenance", re.compile(r"\b(mejoras planificadas|planned (work|outage|maintenance)|mantenimiento programado)\b", re.IGNORECASE)),
    ("weather",     re.compile(r"\b(storm|tormenta|lightning|relámpago|relampago|wind|viento|rain|lluvia|hurricane|huracán|huracan)\b", re.IGNORECASE)),
]


@dataclass(frozen=True)
class Prediction:
    outage_event_id: str
    cause: str
    confidence: str
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


def _weather_at(muni_id: str | None, ts: datetime) -> dict[str, Any] | None:
    if not muni_id:
        return None
    res = (
        supabase()
        .table("weather_snapshots")
        .select("ts, wind_kph, gust_kph, precip_mm, alert_level")
        .eq("municipality_id", muni_id)
        .lte("ts", ts.isoformat())
        .order("ts", desc=True)
        .limit(1)
        .maybeSingle()
        .execute()
        .data
    )
    return res


def _grid_at(ts: datetime) -> dict[str, Any] | None:
    res = (
        supabase()
        .table("grid_snapshots")
        .select("ts, operational_reserve_mw, current_demand_mw, status")
        .lte("ts", ts.isoformat())
        .order("ts", desc=True)
        .limit(1)
        .maybeSingle()
        .execute()
        .data
    )
    return res


def _planned_overlap(muni_id: str | None, ts: datetime) -> bool:
    if not muni_id:
        return False
    res = (
        supabase()
        .table("planned_work")
        .select("id", count="exact", head=True)
        .eq("municipality_id", muni_id)
        .lte("start_ts", ts.isoformat())
        .gte("end_ts", ts.isoformat())
        .execute()
    )
    return int(res.count or 0) > 0


def classify(event: dict[str, Any]) -> Prediction | None:
    eid = event.get("id")
    if not eid:
        return None
    started = _parse_ts(event.get("started_at"))
    if not started:
        return None

    snippet = (event.get("snippet") or "") + " " + (event.get("source_url") or "")
    text_causes: list[tuple[str, str]] = []
    for cause, pattern in PATTERNS:
        match = pattern.search(snippet)
        if match:
            text_causes.append((cause, f"Text matched “{match.group(0).lower()}”"))

    reasons: list[str] = []
    candidates: list[tuple[str, int]] = []  # (cause, score)

    # Planned overlap immediately dominates if present.
    if _planned_overlap(event.get("municipality_id"), started) or any(
        c == "planned_maintenance" for c, _ in text_causes
    ):
        reasons.append("Overlapping planned-work item in this municipality")
        return Prediction(
            outage_event_id=str(eid),
            cause="planned_maintenance",
            confidence="high",
            reasons=reasons,
        )

    # Weather signal.
    weather = _weather_at(event.get("municipality_id"), started) or {}
    wind = float(weather.get("gust_kph") or weather.get("wind_kph") or 0)
    precip = float(weather.get("precip_mm") or 0)
    alert = (weather.get("alert_level") or "").lower()
    if wind >= 60 or precip >= 25 or "warning" in alert or "severe" in alert:
        candidates.append(("weather", 4))
        reasons.append(
            f"Severe weather at start: gust {wind:.0f} kph, precip {precip:.0f} mm, alert={alert or 'none'}"
        )
    elif wind >= 40 or precip >= 10:
        candidates.append(("weather", 2))
        reasons.append("Moderate weather at start")

    # Grid stress signal.
    grid = _grid_at(started) or {}
    reserve = float(grid.get("operational_reserve_mw") or 0)
    demand = float(grid.get("current_demand_mw") or 0)
    if reserve and demand and reserve < demand * 0.04:
        candidates.append(("generation_shortage", 3))
        reasons.append("Reserves were thin at outage start")

    # Text signals at score 2 each (less authoritative than weather + grid
    # context, more useful than blind guessing).
    for cause, reason in text_causes:
        candidates.append((cause, 2))
        reasons.append(reason)

    if not candidates:
        return Prediction(
            outage_event_id=str(eid),
            cause="unknown",
            confidence="low",
            reasons=["No usable signals — falling back to unknown"],
        )

    # Pick the highest-scoring cause; if tie between distinct causes, downgrade
    # confidence rather than guess.
    candidates.sort(key=lambda c: c[1], reverse=True)
    top_cause, top_score = candidates[0]
    second_score = candidates[1][1] if len(candidates) > 1 else 0
    confidence = (
        "high"
        if top_score >= 4 and top_score - second_score >= 2
        else "medium"
        if top_score >= 3
        else "low"
    )

    if (
        len(candidates) > 1
        and candidates[0][1] == candidates[1][1]
        and candidates[0][0] != candidates[1][0]
    ):
        return Prediction(
            outage_event_id=str(eid),
            cause="unknown",
            confidence="low",
            reasons=reasons + ["Multiple causes tied — refusing to guess"],
        )

    return Prediction(
        outage_event_id=str(eid),
        cause=top_cause,
        confidence=confidence,
        reasons=reasons,
    )


def _upsert(predictions: Iterable[Prediction]) -> int:
    payload = [
        {
            "outage_event_id": p.outage_event_id,
            "ts": _now().isoformat(),
            "cause": p.cause,
            "confidence": p.confidence,
            "model_version": MODEL_VERSION,
            "reasons": p.reasons,
        }
        for p in predictions
    ]
    if not payload:
        return 0
    supabase().table("cause_predictions").upsert(
        payload, on_conflict="outage_event_id"
    ).execute()
    return len(payload)


def run() -> int:
    rows = (
        supabase()
        .table("outage_events")
        .select("id, municipality_id, started_at, ended_at, kind, snippet, source_url")
        .order("started_at", desc=True)
        .limit(200)
        .execute()
        .data
        or []
    )
    predictions: list[Prediction] = []
    for row in rows:
        pred = classify(row)
        if pred:
            predictions.append(pred)
    written = _upsert(predictions)
    log.info("cause_classifier: wrote %d classifications over %d events", written, len(rows))
    return written


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    sys.exit(0 if run() >= 0 else 1)
