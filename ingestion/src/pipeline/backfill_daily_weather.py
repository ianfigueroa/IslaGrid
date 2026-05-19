"""
Populate `daily_weather_by_muni` from Open-Meteo's free historical archive.

Why this exists:
  - We want temp/wind/gust/precip per (muni, day) for the 3y backfill
    window so the LightGBM trainer can learn weather → outage.
  - Earlier approach (`backfill_weather_features.py`) PATCHed each
    `outage_features` row one HTTP call at a time → 25k rows × 90ms
    = 37 min, blowing the GH Actions 30 min timeout.
  - This script caches weather to its own table once, then
    `backfill_outage_features` joins it inline at feature-synthesis time.
    Total cost moves from O(features) HTTP per backfill → O(munis) HTTP
    one-time.

Cadence: run once; re-run only to extend the date range or refresh recent
days. Idempotent (upsert on PK).

API: Open-Meteo archive — free for non-commercial use, no auth, generous
quota. One call per muni covers the entire date range.
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from datetime import UTC, datetime
from typing import Any

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from .supabase_client import supabase

log = logging.getLogger(__name__)

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
USER_AGENT = "islagrid-ai/0.1 (+contact@islagrid.app)"
DEFAULT_START = "2023-01-01"
INTER_CALL_SLEEP_S = 0.2  # polite gap; Open-Meteo asks for ~100ms minimum


@retry(wait=wait_exponential(min=2, max=20), stop=stop_after_attempt(4), reraise=True)
def _fetch_daily(
    lon: float, lat: float, start: str, end: str
) -> dict[str, list[Any]]:
    params = {
        "latitude": f"{lat:.4f}",
        "longitude": f"{lon:.4f}",
        "start_date": start,
        "end_date": end,
        "daily": ",".join(
            [
                "temperature_2m_mean",
                "wind_speed_10m_max",
                "wind_gusts_10m_max",
                "precipitation_sum",
            ]
        ),
        "wind_speed_unit": "kmh",
        "timezone": "America/Puerto_Rico",
    }
    with httpx.Client(timeout=60.0, headers={"User-Agent": USER_AGENT}) as c:
        r = c.get(ARCHIVE_URL, params=params)
        r.raise_for_status()
        return (r.json() or {}).get("daily") or {}


def _load_centroids() -> list[tuple[str, float, float]]:
    sb = supabase()
    rows = (
        sb.table("municipalities")
        .select("id, centroid_lon, centroid_lat")
        .execute()
        .data
        or []
    )
    out: list[tuple[str, float, float]] = []
    for r in rows:
        lon = r.get("centroid_lon")
        lat = r.get("centroid_lat")
        if lon is None or lat is None:
            continue
        out.append((r["id"], float(lon), float(lat)))
    out.sort()
    return out


def _existing_dates_for(muni: str) -> tuple[str | None, str | None]:
    """Return (min_day, max_day) already cached for this muni."""
    sb = supabase()
    rows = (
        sb.table("daily_weather_by_muni")
        .select("day")
        .eq("municipality_id", muni)
        .order("day", desc=False)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        return None, None
    earliest = rows[0]["day"]
    rows = (
        sb.table("daily_weather_by_muni")
        .select("day")
        .eq("municipality_id", muni)
        .order("day", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    latest = rows[0]["day"] if rows else earliest
    return earliest, latest


def _upsert_chunk(rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    sb = supabase()
    sb.table("daily_weather_by_muni").upsert(
        rows, on_conflict="municipality_id,day"
    ).execute()


def run(start: str = DEFAULT_START, end: str | None = None) -> int:
    if end is None:
        end = datetime.now(UTC).date().isoformat()
    munis = _load_centroids()
    log.info("Loading weather for %d munis (%s → %s)", len(munis), start, end)
    total = 0
    for i, (muni, lon, lat) in enumerate(munis, 1):
        # Skip the per-muni call entirely if cached range already covers it
        # — Open-Meteo doesn't change for past dates, no point re-fetching.
        cached_min, cached_max = _existing_dates_for(muni)
        if cached_min and cached_max and cached_min <= start and cached_max >= end:
            log.info(
                "[%d/%d] %s — cached (%s → %s), skipping",
                i,
                len(munis),
                muni,
                cached_min,
                cached_max,
            )
            continue
        log.info(
            "[%d/%d] %s lat=%.3f lon=%.3f %s → %s",
            i,
            len(munis),
            muni,
            lat,
            lon,
            start,
            end,
        )
        try:
            daily = _fetch_daily(lon, lat, start, end)
        except Exception as e:
            log.warning("open-meteo fetch failed for %s: %s", muni, e)
            time.sleep(INTER_CALL_SLEEP_S)
            continue
        days = daily.get("time") or []
        temps = daily.get("temperature_2m_mean") or []
        winds = daily.get("wind_speed_10m_max") or []
        gusts = daily.get("wind_gusts_10m_max") or []
        precs = daily.get("precipitation_sum") or []
        chunk: list[dict[str, Any]] = []
        for d, t, w, g, p in zip(days, temps, winds, gusts, precs):
            chunk.append(
                {
                    "municipality_id": muni,
                    "day": d,
                    "temp_c": float(t) if t is not None else None,
                    "wind_kph": float(w) if w is not None else None,
                    "gust_kph": float(g) if g is not None else None,
                    "precip_mm": float(p) if p is not None else None,
                }
            )
        try:
            # One upsert per muni — 1 HTTP call for ~1100 daily rows.
            _upsert_chunk(chunk)
        except Exception as e:
            log.error("upsert failed for %s: %s", muni, e)
            time.sleep(INTER_CALL_SLEEP_S)
            continue
        total += len(chunk)
        log.info("  ↳ upserted %d days", len(chunk))
        time.sleep(INTER_CALL_SLEEP_S)
    log.info("backfill_daily_weather: done; wrote/refreshed %d rows", total)
    return total


def main() -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--start", default=DEFAULT_START)
    p.add_argument("--end", default=None)
    args = p.parse_args()
    return run(start=args.start, end=args.end)


if __name__ == "__main__":
    sys.exit(0 if main() >= 0 else 1)
