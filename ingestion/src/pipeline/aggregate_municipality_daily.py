"""
Phase 24 — per-municipality daily outage rollup.

Reads from three upstream sources and produces one row per (municipality, day)
in `municipality_outage_daily`:

  - outage_events            : muni-tagged unplanned/planned events
  - cause_predictions        : heuristic cause label per event
  - eagle_i_outages          : historic 15-min county-level customer-out counts

The rollup powers the /m/[id] reliability page (calendar, monthly chart, cause
breakdown). Without it the page would have to join three tables on every
request — fine for one user, painful at scale.

Design notes
------------
- Idempotent: re-running upserts the same rows, so cron + manual catch-up both
  work without dedupe logic.
- Source attribution: the `source` column on each row records *which* upstream
  produced it (`outage_events`, `eagle_i`, or `merged`). If we ever disagree
  on totals, that field tells us which to trust.
- Window: defaults to the last 30 days for hourly runs; pass `--backfill-days
  N` for a one-shot longer fill. Long fills are bounded so a misconfig can't
  rewrite years of history accidentally.
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, Iterable

from .supabase_client import supabase

log = logging.getLogger(__name__)

# Map cause_predictions.cause → the daily-rollup bucket column suffix.
CAUSE_TO_BUCKET: dict[str, str] = {
    "weather": "cause_weather_hours",
    "vegetation": "cause_weather_hours",
    "planned_maintenance": "cause_planned_hours",
    "generation_shortage": "cause_generation_hours",
    "transmission": "cause_distribution_hours",
    "distribution": "cause_distribution_hours",
    "equipment": "cause_distribution_hours",
}
DEFAULT_BUCKET = "cause_unknown_hours"

# Hard cap for events with ended_at = NULL. Matches lib/reliability.ts
# MAX_OPEN_EVENT_HOURS so the two paths agree on how long an "open" event
# can plausibly inflate history before we treat it as a stuck notice.
MAX_OPEN_EVENT_HOURS = 8


@dataclass
class DailyAgg:
    """Per (municipality, day) accumulator."""

    municipality_id: str
    day: date
    outage_hours: float = 0.0
    outage_events: int = 0
    cause_generation_hours: float = 0.0
    cause_distribution_hours: float = 0.0
    cause_weather_hours: float = 0.0
    cause_planned_hours: float = 0.0
    cause_unknown_hours: float = 0.0
    customer_minutes: int = 0
    source: str = "outage_events"


def _iso_day(d: date) -> str:
    return d.isoformat()


def _split_event_by_day(
    started: datetime, ended: datetime
) -> list[tuple[date, float]]:
    """Slice an event into per-day hour chunks, so a multi-day outage
    contributes the right number of hours to each calendar day."""
    out: list[tuple[date, float]] = []
    cursor = started
    while cursor.date() <= ended.date():
        day_end = datetime(
            cursor.year, cursor.month, cursor.day, tzinfo=UTC
        ) + timedelta(days=1)
        slice_end = min(ended, day_end)
        hours = max(0.0, (slice_end - cursor).total_seconds() / 3600.0)
        if hours > 0:
            out.append((cursor.date(), hours))
        cursor = day_end
    return out


def _kind_to_bucket(
    kind: str | None, cause: str | None
) -> str:
    """Pick which cause bucket gets the hours for this event."""
    if kind == "planned":
        return "cause_planned_hours"
    if cause and cause in CAUSE_TO_BUCKET:
        return CAUSE_TO_BUCKET[cause]
    return DEFAULT_BUCKET


def _fetch_events(window_start: datetime) -> list[dict[str, Any]]:
    """Pull outage_events with their cause prediction, joined in app code
    because PostgREST doesn't do the JOIN we want without a view."""
    # PostgREST caps responses at 1000 rows by default — paginate so multi-year
    # backfills don't silently truncate.
    page_size = 1000
    offset = 0
    events: list[dict[str, Any]] = []
    while True:
        chunk = (
            supabase()
            .table("outage_events")
            .select("id, municipality_id, started_at, ended_at, kind")
            .gte("started_at", window_start.isoformat())
            .order("started_at", desc=False)
            .range(offset, offset + page_size - 1)
            .execute()
            .data
            or []
        )
        if not chunk:
            break
        events.extend(chunk)
        if len(chunk) < page_size:
            break
        offset += page_size
    if not events:
        return []
    ids = [e["id"] for e in events]
    # PostgREST `in_` cap is generous (~1000) — chunk to be safe.
    causes: dict[str, str] = {}
    for chunk_start in range(0, len(ids), 500):
        chunk_ids = ids[chunk_start : chunk_start + 500]
        rows = (
            supabase()
            .table("cause_predictions")
            .select("outage_event_id, cause")
            .in_("outage_event_id", chunk_ids)
            .execute()
            .data
            or []
        )
        for r in rows:
            causes[r["outage_event_id"]] = r["cause"]
    for e in events:
        e["_cause"] = causes.get(e["id"])
    return events


def _fetch_eagle_i(window_start: datetime) -> list[dict[str, Any]]:
    """Eagle-i is 15-min customer-out counts. We sum customer-minutes per
    (muni, day) so the rollup can show SAIDI-equivalents later. Today we don't
    convert these into outage_hours (would double-count with outage_events),
    only into customer_minutes."""
    # 3 years × 6 munis × 96 ticks/day ≈ 630k rows. PostgREST's default 1000-
    # row cap silently truncates this — paginate so the rollup sees every tick.
    page_size = 1000
    offset = 0
    rows: list[dict[str, Any]] = []
    while True:
        chunk = (
            supabase()
            .table("eagle_i_outages")
            .select("municipality_id, ts, customers_out")
            .gte("ts", window_start.isoformat())
            .not_.is_("municipality_id", "null")
            .order("ts", desc=False)
            .range(offset, offset + page_size - 1)
            .execute()
            .data
            or []
        )
        if not chunk:
            break
        rows.extend(chunk)
        if len(chunk) < page_size:
            break
        offset += page_size
    return rows


def _parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def aggregate(window_days: int) -> dict[tuple[str, date], DailyAgg]:
    """Build the rollup map in memory. Caller decides how many days back."""
    window_start = datetime.now(UTC) - timedelta(days=window_days)
    aggs: dict[tuple[str, date], DailyAgg] = {}

    events = _fetch_events(window_start)
    open_event_caps = 0
    for event in events:
        muni_id = event.get("municipality_id")
        if not muni_id:
            continue
        started = _parse_ts(event.get("started_at"))
        if not started:
            continue
        raw_ended = _parse_ts(event.get("ended_at"))
        if raw_ended is None:
            # ended_at missing — most scrapers don't set it. Cap so a stale
            # announcement doesn't claim days of "outage time".
            cap = started + timedelta(hours=MAX_OPEN_EVENT_HOURS)
            ended = min(datetime.now(UTC), cap)
            if ended == cap:
                open_event_caps += 1
        else:
            ended = raw_ended
        if ended < started:
            continue
        bucket = _kind_to_bucket(event.get("kind"), event.get("_cause"))
        for day, hours in _split_event_by_day(started, ended):
            key = (muni_id, day)
            agg = aggs.get(key) or DailyAgg(muni_id, day)
            agg.outage_hours += hours
            # Count an event only on its start day so totals don't double.
            if day == started.date():
                agg.outage_events += 1
            setattr(agg, bucket, getattr(agg, bucket) + hours)
            aggs[key] = agg

    if open_event_caps:
        log.warning(
            "municipality_outage_daily: capped %d open events at %dh "
            "(ended_at=NULL fallback)",
            open_event_caps,
            MAX_OPEN_EVENT_HOURS,
        )

    eagle = _fetch_eagle_i(window_start)
    # Eagle-i samples every 15 min. customer-minutes per sample = customers * 15.
    SAMPLE_MINUTES = 15
    for row in eagle:
        muni_id = row.get("municipality_id")
        ts = _parse_ts(row.get("ts"))
        customers = int(row.get("customers_out") or 0)
        if not muni_id or not ts or customers <= 0:
            continue
        key = (muni_id, ts.date())
        agg = aggs.get(key) or DailyAgg(muni_id, ts.date(), source="merged")
        agg.customer_minutes += customers * SAMPLE_MINUTES
        # When the muni has no outage_events for the day but does have eagle-i
        # signal, mark the source so the API knows it's the secondary path.
        if agg.outage_hours == 0 and agg.outage_events == 0:
            agg.source = "eagle_i"
        aggs[key] = agg

    return aggs


def _to_payload(aggs: Iterable[DailyAgg]) -> list[dict[str, Any]]:
    now = datetime.now(UTC).isoformat()
    return [
        {
            "municipality_id": a.municipality_id,
            "day": _iso_day(a.day),
            "outage_hours": round(a.outage_hours, 3),
            "outage_events": a.outage_events,
            "cause_generation_hours": round(a.cause_generation_hours, 3),
            "cause_distribution_hours": round(a.cause_distribution_hours, 3),
            "cause_weather_hours": round(a.cause_weather_hours, 3),
            "cause_planned_hours": round(a.cause_planned_hours, 3),
            "cause_unknown_hours": round(a.cause_unknown_hours, 3),
            "customer_minutes": a.customer_minutes,
            "source": a.source,
            "updated_at": now,
        }
        for a in aggs
    ]


def upsert(aggs: dict[tuple[str, date], DailyAgg]) -> int:
    payload = _to_payload(aggs.values())
    if not payload:
        return 0
    # Chunk so very large backfills don't blow the request size limit. On a
    # chunk failure, log which slice + size before re-raising so a long
    # backfill is debuggable instead of just emitting a bare stack trace.
    written = 0
    for start in range(0, len(payload), 500):
        chunk = payload[start : start + 500]
        try:
            supabase().table("municipality_outage_daily").upsert(
                chunk, on_conflict="municipality_id,day"
            ).execute()
        except Exception as e:
            log.error(
                "municipality_outage_daily: upsert failed at offset %d (chunk size %d): %s",
                start,
                len(chunk),
                e,
            )
            raise
        written += len(chunk)
    return written


def run(window_days: int) -> int:
    aggs = aggregate(window_days)
    written = upsert(aggs)
    log.info(
        "municipality_outage_daily: wrote %d rows over %d-day window",
        written,
        window_days,
    )
    return written


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--backfill-days",
        type=int,
        default=30,
        help="How many days back to aggregate. Default 30; max 5000 (≈13y) for full Eagle-i archive backfills.",
    )
    args = parser.parse_args()
    # 5000d ≈ 13y — covers the Eagle-i archive (2014→present) with headroom and
    # still rejects obvious unit-mistakes like passing seconds instead of days.
    if args.backfill_days < 1 or args.backfill_days > 5000:
        parser.error("--backfill-days must be between 1 and 5000")
    return 0 if run(args.backfill_days) >= 0 else 1


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    sys.exit(main())
