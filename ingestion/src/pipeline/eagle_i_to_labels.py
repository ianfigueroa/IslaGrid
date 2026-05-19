"""
Convert Eagle-i 15-minute customer-out counts into discrete `outage_labels`.

The ML trainer needs supervised labels of the form
``(municipality_id, started_at, ended_at, severity)``. Eagle-i publishes a
raw time series — customers_out per county per 15 min — that has the right
*signal* but the wrong *shape*. This module bridges the two.

Algorithm (per municipality):

  1. Walk the 15-min ticks chronologically.
  2. An "event" opens when ``customers_out >= START_THRESHOLD`` (default 100
     households — captures street-scale interruptions while filtering out
     stray meter blips).
  3. An event stays open as long as ``customers_out >= END_THRESHOLD``. It
     closes after ``END_GAP_TICKS`` consecutive ticks below that, so a brief
     dip in the middle doesn't shatter one outage into many.
  4. Severity is graded by the peak customers_out during the event.

Confidence is 0.75 — Eagle-i is federal/aggregated; trusted more than
community reports but less than first-party LUMA/AEEPR rows.

Idempotent: relies on the partial unique index on
``outage_labels (municipality_id, started_at, source)``.
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from .supabase_client import supabase

log = logging.getLogger(__name__)

SOURCE = "eagle_i"
START_THRESHOLD = 100  # customers_out
END_THRESHOLD = 50
END_GAP_TICKS = 2  # 2 × 15min = 30min below END_THRESHOLD to close
CONFIDENCE = 0.75

# Severity thresholds keyed on peak customers_out during the event.
SEVERITY_MINOR_MAX = 500
SEVERITY_MAJOR_MIN = 5_000


@dataclass
class _OpenEvent:
    started_at: datetime
    last_above: datetime
    peak: int
    below_streak: int = 0


def _grade(peak: int) -> str:
    if peak >= SEVERITY_MAJOR_MIN:
        return "major"
    if peak >= SEVERITY_MINOR_MAX:
        return "moderate"
    return "minor"


def _parse_ts(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def _fetch_ticks(window_start: datetime) -> dict[str, list[tuple[datetime, int]]]:
    """All eagle_i ticks since window_start, grouped by municipality_id."""
    page_size = 1000
    offset = 0
    by_muni: dict[str, list[tuple[datetime, int]]] = defaultdict(list)
    sb = supabase()
    while True:
        rows = (
            sb.table("eagle_i_outages")
            .select("municipality_id, ts, customers_out")
            .gte("ts", window_start.isoformat())
            .not_.is_("municipality_id", "null")
            .order("ts", desc=False)
            .range(offset, offset + page_size - 1)
            .execute()
            .data
            or []
        )
        if not rows:
            break
        for r in rows:
            mid = r.get("municipality_id")
            ts = _parse_ts(r.get("ts") or "")
            count = int(r.get("customers_out") or 0)
            if not mid or not ts:
                continue
            by_muni[mid].append((ts, count))
        if len(rows) < page_size:
            break
        offset += page_size
    return by_muni


def _detect_events(
    ticks: list[tuple[datetime, int]],
) -> list[tuple[datetime, datetime, int]]:
    """[(started_at, ended_at, peak), ...] for one muni, given sorted ticks."""
    events: list[tuple[datetime, datetime, int]] = []
    open_event: _OpenEvent | None = None
    for ts, count in ticks:
        if open_event is None:
            if count >= START_THRESHOLD:
                open_event = _OpenEvent(started_at=ts, last_above=ts, peak=count)
            continue
        if count >= END_THRESHOLD:
            open_event.last_above = ts
            open_event.below_streak = 0
            if count > open_event.peak:
                open_event.peak = count
            continue
        open_event.below_streak += 1
        if open_event.below_streak >= END_GAP_TICKS:
            events.append(
                (open_event.started_at, open_event.last_above, open_event.peak)
            )
            open_event = None
    if open_event is not None:
        # Series ended mid-outage — close it at the last above-threshold tick.
        events.append(
            (open_event.started_at, open_event.last_above, open_event.peak)
        )
    return events


def run(window_days: int = 365) -> int:
    window_start = datetime.now(timezone.utc) - timedelta(days=window_days)
    by_muni = _fetch_ticks(window_start)
    if not by_muni:
        log.warning("eagle_i_to_labels: no ticks in last %d days", window_days)
        return 0

    payload: list[dict[str, object]] = []
    for muni_id, ticks in by_muni.items():
        for started_at, ended_at, peak in _detect_events(ticks):
            payload.append(
                {
                    "municipality_id": muni_id,
                    "started_at": started_at.isoformat(),
                    "ended_at": ended_at.isoformat(),
                    "severity": _grade(peak),
                    "source": SOURCE,
                    "confidence": CONFIDENCE,
                }
            )

    if not payload:
        log.info("eagle_i_to_labels: no events detected")
        return 0

    sb = supabase()
    written = 0
    for start in range(0, len(payload), 500):
        chunk = payload[start : start + 500]
        try:
            sb.table("outage_labels").upsert(
                chunk,
                on_conflict="municipality_id,started_at,source",
                ignore_duplicates=True,
            ).execute()
        except Exception as exc:
            log.error(
                "outage_labels upsert failed at offset %d (chunk size %d): %s",
                start,
                len(chunk),
                exc,
            )
            raise
        written += len(chunk)
    log.info("eagle_i_to_labels: wrote %d events across %d munis", written, len(by_muni))
    return written


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--window-days",
        type=int,
        default=365,
        help="How far back to scan eagle_i_outages. Default 365.",
    )
    args = parser.parse_args()
    return 0 if run(window_days=args.window_days) >= 0 else 1


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    sys.exit(main())
