"""
Region-level unplanned outage events from `luma_outage_snapshots`.

Why this exists
---------------
`outage_events` used to only contain LUMA's planned-work announcements
(every event row had `kind='planned'`) because there was no scraper that
produced an "unplanned event" row. The closest live signal is the 5-min
LUMA region poll (`luma_outage_snapshots`), which shows the current count
of affected customers per region but isn't a discrete event stream.

This pipeline walks each region's snapshot timeline and detects "outage
episodes": continuous spans where `customers_affected` stays above a
threshold. Each episode becomes one row in `outage_events` with
`kind='unplanned'`. Episodes are tagged at the REGION level — we set
`municipality_id` to NULL because LUMA's region totals don't tell us
which specific muni was affected; the per-muni allocation already lives
in `aggregate_luma_regions_to_munis.py`.

Design choices
--------------
- **Thresholds with hysteresis.** An episode OPENS when affected crosses
  `OPEN_THRESHOLD` (50 customers) and CLOSES when it drops to
  `CLOSE_THRESHOLD` (10 customers). A single threshold flickers events
  open/closed across normal LUMA reporting noise.
- **Min duration.** Episodes shorter than `MIN_EPISODE_HOURS` (10 minutes)
  are dropped to avoid attributing noise as outages.
- **Gap handling.** If two consecutive snapshots are more than
  `MAX_GAP_HOURS` (1.5h) apart, we treat the gap as missing data and
  close any open episode — same convention as the region-split pipeline.
- **Idempotent.** Event IDs are hashed from (region, started_at) so
  re-running the same window upserts in place. Open episodes (still
  active right now) re-upsert each run with the freshest `ended_at`
  estimate.

The output rows feed any consumer that wants "real outage events" —
the cause classifier, map sonar-pings, and any future per-event ETA model.
"""

from __future__ import annotations

import argparse
import hashlib
import logging
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from .supabase_client import supabase

log = logging.getLogger(__name__)

OPEN_THRESHOLD = 50
CLOSE_THRESHOLD = 10
MIN_EPISODE_HOURS = 10 / 60  # 10 minutes
MAX_GAP_HOURS = 1.5
SOURCE_LABEL = "lumapr.com/outage-map"


@dataclass
class Episode:
    region_id: str
    region_name: str
    started_at: datetime
    ended_at: datetime | None = None
    peak_affected: int = 0
    snippets: list[str] = field(default_factory=list)


def _parse_ts(v: Any) -> datetime | None:
    if not v:
        return None
    s = str(v).replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None


def _fetch_snapshots(since: datetime) -> dict[tuple[str, str], list[dict[str, Any]]]:
    """{ (region_id, region_name): [snapshot rows sorted by ts] }"""
    sb = supabase()
    rows: list[dict[str, Any]] = []
    page = 1000
    offset = 0
    while True:
        chunk = (
            sb.table("luma_outage_snapshots")
            .select("ts, region_id, region_name, customers_affected")
            .gte("ts", since.isoformat())
            .order("ts", desc=False)
            .range(offset, offset + page - 1)
            .execute()
            .data
            or []
        )
        if not chunk:
            break
        rows.extend(chunk)
        if len(chunk) < page:
            break
        offset += page

    grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for r in rows:
        ts = _parse_ts(r.get("ts"))
        if not ts:
            continue
        key = (r.get("region_id") or "", r.get("region_name") or "")
        grouped.setdefault(key, []).append({**r, "ts": ts})
    for key in grouped:
        grouped[key].sort(key=lambda x: x["ts"])
    return grouped


def _detect_episodes(snaps: list[dict[str, Any]], region_id: str, region_name: str) -> list[Episode]:
    """Walk the snapshot timeline; open/close episodes by threshold + gap."""
    episodes: list[Episode] = []
    current: Episode | None = None
    last_ts: datetime | None = None
    for snap in snaps:
        ts: datetime = snap["ts"]
        aff = int(snap.get("customers_affected") or 0)

        if last_ts is not None:
            gap_h = (ts - last_ts).total_seconds() / 3600.0
            if gap_h > MAX_GAP_HOURS and current is not None:
                # Long poll gap — treat current episode as having closed at the
                # last known sample to avoid attributing the gap as outage.
                current.ended_at = last_ts
                episodes.append(current)
                current = None

        if current is None:
            if aff >= OPEN_THRESHOLD:
                current = Episode(
                    region_id=region_id,
                    region_name=region_name,
                    started_at=ts,
                    peak_affected=aff,
                )
        else:
            current.peak_affected = max(current.peak_affected, aff)
            if aff <= CLOSE_THRESHOLD:
                current.ended_at = ts
                episodes.append(current)
                current = None
        last_ts = ts

    # Episode still open at the end of the window stays open (ended_at=None).
    if current is not None:
        episodes.append(current)

    # Drop sub-minute flickers.
    return [
        e for e in episodes
        if e.ended_at is None
        or (e.ended_at - e.started_at).total_seconds() / 3600.0 >= MIN_EPISODE_HOURS
    ]


def _to_event_row(ep: Episode) -> dict[str, Any]:
    started_iso = ep.started_at.isoformat()
    # Hash on (region, started_at) so re-runs upsert in place. Use the slugged
    # region_id to keep ids stable even if region_name capitalization shifts.
    digest = hashlib.sha1(
        f"luma-outage-map|{ep.region_id}|{started_iso}".encode("utf-8")
    ).hexdigest()[:16]
    ended_iso = ep.ended_at.isoformat() if ep.ended_at else None
    snippet = (
        f"LUMA region {ep.region_name}: peak {ep.peak_affected:,} customers affected"
    )
    return {
        "id": f"ev:luma:{digest}",
        "municipality_id": None,  # region-level only
        "started_at": started_iso,
        "ended_at": ended_iso,
        "kind": "unplanned",
        "source": SOURCE_LABEL,
        "source_url": "https://miluma.lumapr.com/outages/status",
        "snippet": snippet,
        "raw_key": None,
    }


def run(backfill_days: int = 365) -> int:
    since = datetime.now(UTC) - timedelta(days=backfill_days)
    log.info(
        "luma_snapshots_to_events: scanning snapshots since %s",
        since.isoformat(),
    )
    grouped = _fetch_snapshots(since)
    if not grouped:
        log.info("no snapshots in window — nothing to do")
        return 0

    rows: list[dict[str, Any]] = []
    for (region_id, region_name), snaps in grouped.items():
        if not region_id:
            continue
        episodes = _detect_episodes(snaps, region_id, region_name)
        for ep in episodes:
            rows.append(_to_event_row(ep))
        log.info(
            "region %s: %d snapshots → %d episodes",
            region_id,
            len(snaps),
            len(episodes),
        )

    if not rows:
        log.info("no episodes detected")
        return 0

    sb = supabase()
    written = 0
    for start in range(0, len(rows), 500):
        chunk = rows[start : start + 500]
        try:
            sb.table("outage_events").upsert(chunk, on_conflict="id").execute()
        except Exception as exc:
            log.error(
                "outage_events upsert failed at offset %d (%d rows): %s",
                start,
                len(chunk),
                exc,
            )
            raise
        written += len(chunk)
    log.info("luma_snapshots_to_events: upserted %d events", written)
    return written


def main() -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--backfill-days",
        type=int,
        default=365,
        help="how many days back to scan snapshots (default 365, max 1200)",
    )
    args = p.parse_args()
    if args.backfill_days < 1 or args.backfill_days > 1200:
        log.error("--backfill-days must be between 1 and 1200")
        return 2
    return 0 if run(backfill_days=args.backfill_days) >= 0 else 1


if __name__ == "__main__":
    sys.exit(main())
