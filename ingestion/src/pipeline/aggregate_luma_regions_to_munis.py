"""
Region-level → per-muni outage fill-in.

Why this exists
---------------
`municipality_outage_daily` is populated by two narrow sources today:

  * `outage_events`  — LUMA's published *incidents* (28/78 munis got an
    incident post in the last 30 days; small/rural munis basically never
    appear)
  * `eagle_i`        — federal feed, 6 metros only

That leaves 50 munis with `—` on the scorecard, even though we DO have
data covering them — just at LUMA's 7-region granularity in
`luma_outage_snapshots`.

This pipeline:

  1. Walks `luma_outage_snapshots` per region in chronological order.
  2. For each snapshot pair, attributes  `customers_affected × Δhours`
     of customer-outage-hours to the snapshot's day (clamped so a long
     poll gap doesn't attribute a phantom 24h outage).
  3. Normalizes per-day customer-hours by the region's customer base to
     get "the average customer here lost power for X hours that day".
  4. Writes that estimate to every muni in the region, but ONLY where
     `municipality_outage_daily` doesn't already carry a real per-muni
     row (so genuine `outage_events`/`eagle_i` data wins over the
     regional approximation).

The row is tagged `source='luma-region-split'` so the UI can render a
"regional estimate" badge if we want to be explicit later.
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from typing import Any

from .supabase_client import supabase

log = logging.getLogger(__name__)

# Mirror of lib/luma-regions.ts. Keep in sync if a muni is reassigned.
LUMA_REGIONS: dict[str, list[str]] = {
    "san-juan": ["san-juan"],
    "bayamon": [
        "bayamon",
        "toa-alta",
        "toa-baja",
        "catano",
        "guaynabo",
        "comerio",
        "naranjito",
        "corozal",
        "vega-alta",
        "dorado",
    ],
    "carolina": [
        "carolina",
        "trujillo-alto",
        "loiza",
        "rio-grande",
        "canovanas",
        "luquillo",
        "fajardo",
        "ceiba",
        "vieques",
        "culebra",
    ],
    "caguas": [
        "caguas",
        "aguas-buenas",
        "san-lorenzo",
        "gurabo",
        "juncos",
        "las-piedras",
        "humacao",
        "naguabo",
        "yabucoa",
        "maunabo",
        "cidra",
        "cayey",
        "aibonito",
        "barranquitas",
        "patillas",
        "arroyo",
        "guayama",
    ],
    "mayaguez": [
        "mayaguez",
        "hormigueros",
        "san-german",
        "cabo-rojo",
        "lajas",
        "sabana-grande",
        "maricao",
        "las-marias",
        "anasco",
        "rincon",
        "aguada",
        "aguadilla",
        "moca",
        "san-sebastian",
    ],
    "ponce": [
        "ponce",
        "adjuntas",
        "jayuya",
        "juana-diaz",
        "santa-isabel",
        "coamo",
        "salinas",
        "villalba",
        "guayanilla",
        "penuelas",
        "yauco",
        "guanica",
    ],
    "arecibo": [
        "arecibo",
        "camuy",
        "quebradillas",
        "isabela",
        "lares",
        "utuado",
        "hatillo",
        "manati",
        "vega-baja",
        "florida",
        "ciales",
        "barceloneta",
        "morovis",
        "orocovis",
    ],
}

# If two consecutive snapshots are more than this apart we treat the
# customers_affected value as untrustworthy for the gap and stop
# accruing. Without this, a multi-hour scraper outage would be billed
# as a real outage.
MAX_INTERVAL_HOURS = 1.5

SOURCE_LABEL = "luma-region-split"


def _parse_ts(v: Any) -> datetime | None:
    if not v:
        return None
    s = str(v).replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None


def _fetch_snapshots(region_id: str, since: datetime) -> list[dict[str, Any]]:
    """Paginate luma_outage_snapshots for one region."""
    sb = supabase()
    rows: list[dict[str, Any]] = []
    page = 1000
    offset = 0
    while True:
        chunk = (
            sb.table("luma_outage_snapshots")
            .select("ts, customers_affected, customers_served")
            .eq("region_id", region_id)
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
    return rows


def _existing_keys(start: date, end: date) -> set[tuple[str, str]]:
    """Return (muni_id, day-iso) pairs already in municipality_outage_daily.

    We never overwrite real data with our regional estimate.
    """
    sb = supabase()
    seen: set[tuple[str, str]] = set()
    page = 1000
    offset = 0
    while True:
        chunk = (
            sb.table("municipality_outage_daily")
            .select("municipality_id, day")
            .gte("day", start.isoformat())
            .lte("day", end.isoformat())
            .range(offset, offset + page - 1)
            .execute()
            .data
            or []
        )
        if not chunk:
            break
        for r in chunk:
            seen.add((r["municipality_id"], r["day"]))
        if len(chunk) < page:
            break
        offset += page
    return seen


def _per_day_avg_customer_hours(
    snapshots: list[dict[str, Any]],
) -> dict[date, tuple[float, float]]:
    """Return {day: (customer_hours_out, customer_base_estimate)} for one region.

    customer_hours_out:   integral of `customers_affected` over the day
    customer_base_estimate: max(customers_served) seen during the day —
                            the closest thing to a "region size" we have.
    """
    by_day: dict[date, dict[str, float]] = defaultdict(lambda: {"hrs": 0.0, "base": 0.0})
    parsed = [
        (_parse_ts(s.get("ts")), s.get("customers_affected"), s.get("customers_served"))
        for s in snapshots
    ]
    parsed = [(t, a, b) for (t, a, b) in parsed if t is not None]
    parsed.sort(key=lambda r: r[0])

    for i, (ts_i, aff_i, served_i) in enumerate(parsed):
        if i + 1 < len(parsed):
            ts_next = parsed[i + 1][0]
            delta_h = (ts_next - ts_i).total_seconds() / 3600.0
        else:
            delta_h = 0.0
        delta_h = max(0.0, min(delta_h, MAX_INTERVAL_HOURS))
        day = ts_i.astimezone(UTC).date()
        bucket = by_day[day]
        bucket["hrs"] += float(aff_i or 0) * delta_h
        if served_i is not None:
            bucket["base"] = max(bucket["base"], float(served_i))

    return {d: (v["hrs"], v["base"]) for d, v in by_day.items()}


def run(backfill_days: int = 365) -> int:
    sb = supabase()
    end_day = datetime.now(UTC).date()
    start_day = end_day - timedelta(days=backfill_days)
    since = datetime.combine(start_day, datetime.min.time(), tzinfo=UTC)

    log.info(
        "luma region split: backfilling %s → %s (%d days)",
        start_day,
        end_day,
        backfill_days,
    )

    existing = _existing_keys(start_day, end_day)
    log.info("found %d existing (muni, day) rows we won't overwrite", len(existing))

    payload: list[dict[str, Any]] = []
    skipped_no_base = 0
    total_days = 0

    for region_id, muni_ids in LUMA_REGIONS.items():
        snaps = _fetch_snapshots(region_id, since)
        if not snaps:
            log.warning("region %s: no snapshots in window", region_id)
            continue
        per_day = _per_day_avg_customer_hours(snaps)
        log.info(
            "region %s: %d snapshots → %d days of data",
            region_id,
            len(snaps),
            len(per_day),
        )
        for day, (customer_hours, customer_base) in per_day.items():
            if customer_base <= 0:
                # Without a base we can't normalize. Skip.
                skipped_no_base += 1
                continue
            # Average outage hours per customer in the region for this day.
            avg_hours = customer_hours / customer_base
            total_days += 1
            for muni in muni_ids:
                if (muni, day.isoformat()) in existing:
                    continue
                payload.append(
                    {
                        "municipality_id": muni,
                        "day": day.isoformat(),
                        "outage_hours": round(avg_hours, 4),
                        "outage_events": 0,
                        "cause_generation_hours": 0,
                        "cause_distribution_hours": 0,
                        "cause_weather_hours": 0,
                        "cause_planned_hours": 0,
                        "cause_unknown_hours": round(avg_hours, 4),
                        "customer_minutes": int(customer_hours * 60),
                        "source": SOURCE_LABEL,
                    }
                )

    if skipped_no_base:
        log.warning("skipped %d (region, day) entries with no customer_base", skipped_no_base)

    if not payload:
        log.info("nothing to write")
        return 0

    log.info("upserting %d region-split rows", len(payload))
    written = 0
    for start in range(0, len(payload), 500):
        chunk = payload[start : start + 500]
        try:
            sb.table("municipality_outage_daily").upsert(
                chunk, on_conflict="municipality_id,day"
            ).execute()
        except Exception as exc:
            log.error(
                "municipality_outage_daily upsert failed at offset %d (%d rows): %s",
                start,
                len(chunk),
                exc,
            )
            raise
        written += len(chunk)

    log.info(
        "luma region split: wrote %d rows covering %d region-days", written, total_days
    )
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
        help="how many days back to walk (default 365, max 1200)",
    )
    args = p.parse_args()
    if args.backfill_days < 1 or args.backfill_days > 1200:
        log.error("--backfill-days must be between 1 and 1200")
        return 2
    return run(backfill_days=args.backfill_days)


if __name__ == "__main__":
    sys.exit(0 if main() >= 0 else 1)
