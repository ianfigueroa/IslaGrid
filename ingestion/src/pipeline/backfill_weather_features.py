"""
Backfill weather columns on `outage_features` from Open-Meteo's free
historical archive API.

Why this exists:
  - The LightGBM trainer's feature columns include temp_c, wind_kph,
    gust_kph, precip_mm, prob_precip. For historical (backfilled) feature
    rows those are all NULL → fillna(0) → both heuristic and trained
    model see the same nulled-weather input → near-tie on val Brier.
  - The heuristic itself is 50% weather-weighted, so on rows where
    weather is null the heuristic essentially flattens to grid_stress +
    planned_work — easy for LightGBM to match but hard to beat.
  - Adding real historical weather gives the model something to actually
    discriminate on.

Source: Open-Meteo's archive API. Free for non-commercial use, no auth,
~10k calls/day. We make one call per muni covering its entire label
range (~3y), pulling daily aggregates. That's 78 calls total per run.

What we fill (per feature row):
  - temp_c       ← daily mean temperature_2m_mean
  - wind_kph     ← daily wind_speed_10m_max (already in km/h)
  - gust_kph     ← daily wind_gusts_10m_max
  - precip_mm    ← daily precipitation_sum
  - prob_precip  ← null (Open-Meteo archive doesn't expose a probability
                  field — only what actually happened; leaving null is
                  honest, fillna(0) downstream handles it)

Idempotent: an UPDATE keyed on (ts, municipality_id). Re-runnable.
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from .supabase_client import supabase

log = logging.getLogger(__name__)

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
USER_AGENT = "islagrid-ai/0.1 (+contact@islagrid.app)"
# Open-Meteo asks for a 100ms gap between requests on the free tier; be
# polite even though our 78-call total is well under any quota.
INTER_CALL_SLEEP_S = 0.15


@retry(wait=wait_exponential(min=2, max=20), stop=stop_after_attempt(4), reraise=True)
def _fetch_daily(
    lon: float, lat: float, start: str, end: str
) -> dict[str, list[Any]]:
    """One Open-Meteo archive call covering the full date range."""
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
        body = r.json() or {}
    daily = body.get("daily") or {}
    return daily


def _load_centroids() -> dict[str, tuple[float, float]]:
    sb = supabase()
    rows = (
        sb.table("municipalities")
        .select("id, centroid_lon, centroid_lat")
        .execute()
        .data
        or []
    )
    out: dict[str, tuple[float, float]] = {}
    for r in rows:
        if r.get("centroid_lon") is not None and r.get("centroid_lat") is not None:
            out[r["id"]] = (float(r["centroid_lon"]), float(r["centroid_lat"]))
    return out


def _load_feature_dates() -> dict[str, list[str]]:
    """For each muni, the distinct YYYY-MM-DD dates that need weather."""
    sb = supabase()
    page = 1000
    offset = 0
    by_muni: dict[str, set[str]] = defaultdict(set)
    while True:
        chunk = (
            sb.table("outage_features")
            .select("ts, municipality_id, temp_c")
            .order("ts", desc=False)
            .range(offset, offset + page - 1)
            .execute()
            .data
            or []
        )
        if not chunk:
            break
        for r in chunk:
            # Only touch rows that still need weather (skip live rows that
            # already have temp_c — those came from the live ingest path).
            if r.get("temp_c") is not None:
                continue
            muni = r.get("municipality_id")
            ts_raw = r.get("ts")
            if not muni or not ts_raw:
                continue
            try:
                ts = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))
            except ValueError:
                continue
            by_muni[muni].add(ts.date().isoformat())
        if len(chunk) < page:
            break
        offset += page
    return {m: sorted(d) for m, d in by_muni.items()}


def _build_weather_index(
    centroids: dict[str, tuple[float, float]],
    needed: dict[str, list[str]],
) -> dict[tuple[str, str], dict[str, float | None]]:
    """Hit Open-Meteo once per muni, build {(muni, date): weather}."""
    today_str = datetime.now(UTC).date().isoformat()
    out: dict[tuple[str, str], dict[str, float | None]] = {}
    for i, (muni, dates) in enumerate(needed.items(), 1):
        if muni not in centroids or not dates:
            continue
        # Open-Meteo wants a contiguous range; we pass the date list's min
        # and max even if there are gaps. Daily data is small (~3 KB per
        # year) so over-fetching costs nothing.
        start = dates[0]
        end = min(dates[-1], today_str)
        if start > end:
            continue
        lon, lat = centroids[muni]
        log.info(
            "[%d/%d] %s lat=%.3f lon=%.3f %s → %s (%d dates)",
            i,
            len(needed),
            muni,
            lat,
            lon,
            start,
            end,
            len(dates),
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
        for d, t, w, g, p in zip(days, temps, winds, gusts, precs):
            out[(muni, d)] = {
                "temp_c": float(t) if t is not None else None,
                "wind_kph": float(w) if w is not None else None,
                "gust_kph": float(g) if g is not None else None,
                "precip_mm": float(p) if p is not None else None,
            }
        time.sleep(INTER_CALL_SLEEP_S)
    return out


def _apply_to_features(
    weather: dict[tuple[str, str], dict[str, float | None]],
) -> int:
    """For each feature row missing weather, look up its (muni, date) and
    UPDATE the row. Done one batch per muni to keep request size bounded."""
    sb = supabase()
    page = 1000
    offset = 0
    updated = 0
    while True:
        chunk = (
            sb.table("outage_features")
            .select("ts, municipality_id, temp_c")
            .order("ts", desc=False)
            .range(offset, offset + page - 1)
            .execute()
            .data
            or []
        )
        if not chunk:
            break
        for r in chunk:
            if r.get("temp_c") is not None:
                continue
            muni = r.get("municipality_id")
            ts_raw = r.get("ts")
            if not muni or not ts_raw:
                continue
            try:
                ts = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))
            except ValueError:
                continue
            key = (muni, ts.date().isoformat())
            w = weather.get(key)
            if not w:
                continue
            try:
                sb.table("outage_features").update(w).eq("ts", ts_raw).eq(
                    "municipality_id", muni
                ).execute()
                updated += 1
            except Exception as e:
                log.warning(
                    "update failed for %s %s: %s", muni, ts_raw, e
                )
        if len(chunk) < page:
            break
        offset += page
        if updated and updated % 1000 == 0:
            log.info("Applied weather to %d rows…", updated)
    return updated


def run() -> int:
    log.info("Loading centroids + needed feature dates…")
    centroids = _load_centroids()
    needed = _load_feature_dates()
    if not needed:
        log.info("No feature rows need weather; nothing to do.")
        return 0
    total_dates = sum(len(v) for v in needed.values())
    log.info(
        "%d munis need weather across %d (muni, date) pairs",
        len(needed),
        total_dates,
    )

    log.info("Fetching Open-Meteo archive…")
    weather = _build_weather_index(centroids, needed)
    log.info("Got %d (muni, date) weather rows", len(weather))

    log.info("Applying weather to outage_features…")
    updated = _apply_to_features(weather)
    log.info("backfill_weather_features: done; updated %d feature rows", updated)
    return updated


def main() -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    return run()


if __name__ == "__main__":
    sys.exit(0 if main() >= 0 else 1)
