"""
One-shot backfill of `outage_labels` from existing `outage_events`.

The ML trainer (ingestion/ml/train.py) joins `outage_features` rows against
`outage_labels`; without labels it gates out and the heuristic stays live.
Until now nothing wrote to outage_labels, so the trainer never had supervision
even though we have 200+ outage_events on file.

This script is idempotent — the unique (muni, started_at, source) index in
0006_outage_ml.sql dedupes re-runs. Safe to invoke as part of the predict-
outage workflow before training so any new events get labelled first.
"""

from __future__ import annotations

import argparse
import logging
import sys
from typing import Any

from .supabase_client import supabase

log = logging.getLogger(__name__)


SEVERITY_FALLBACK = "moderate"


def _severity_for(event: dict[str, Any]) -> str:
    """Map upstream event fields to the label schema's enum.

    `outage_events` has no severity column today, but kind+ended_at give us a
    coarse signal: planned work is minor, multi-hour events read as major,
    everything else is moderate. Better signal can replace this later.
    """
    kind = (event.get("kind") or "").lower()
    if kind == "planned":
        return "minor"
    started = event.get("started_at")
    ended = event.get("ended_at")
    if started and ended:
        from datetime import datetime
        try:
            s = datetime.fromisoformat(str(started).replace("Z", "+00:00"))
            e = datetime.fromisoformat(str(ended).replace("Z", "+00:00"))
            hours = max(0.0, (e - s).total_seconds() / 3600.0)
        except ValueError:
            hours = 0.0
        if hours >= 6:
            return "major"
        if hours >= 1:
            return "moderate"
    return SEVERITY_FALLBACK


def _confidence_for(source: str | None) -> float:
    """Trust LUMA/AEEPR rows more than community-submitted ones."""
    if not source:
        return 0.5
    s = source.lower()
    if "luma" in s or "aeepr" in s or "official" in s:
        return 0.9
    if "eagle" in s or "wayback" in s:
        return 0.75
    if "social" in s or "report" in s:
        return 0.4
    return 0.5


def run(limit: int | None = None) -> int:
    sb = supabase()
    page_size = 1000
    offset = 0
    total_written = 0
    while True:
        q = (
            sb.table("outage_events")
            .select("id, municipality_id, started_at, ended_at, kind, source")
            .not_.is_("municipality_id", "null")
            .order("started_at", desc=False)
            .range(offset, offset + page_size - 1)
        )
        events = q.execute().data or []
        if not events:
            break
        payload: list[dict[str, Any]] = []
        for ev in events:
            if not ev.get("started_at"):
                continue
            payload.append(
                {
                    "municipality_id": ev["municipality_id"],
                    "started_at": ev["started_at"],
                    "ended_at": ev.get("ended_at"),
                    "severity": _severity_for(ev),
                    "source": ev.get("source") or "outage_events",
                    "confidence": _confidence_for(ev.get("source")),
                }
            )
        if payload:
            # The unique index on (municipality_id, started_at, source) handles
            # dedupe via on_conflict — re-runs are no-ops.
            sb.table("outage_labels").upsert(
                payload,
                on_conflict="municipality_id,started_at,source",
                ignore_duplicates=True,
            ).execute()
            total_written += len(payload)
        offset += page_size
        if limit and total_written >= limit:
            break
    log.info("outage_labels backfill: wrote %d rows", total_written)
    return total_written


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Cap the number of rows backfilled (default: all).",
    )
    args = parser.parse_args()
    return 0 if run(args.limit) >= 0 else 1


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    sys.exit(main())
