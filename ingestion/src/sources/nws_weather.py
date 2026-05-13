"""
Ingest National Weather Service forecasts and active alerts for Puerto Rico.

The NWS API requires a contact User-Agent (api.weather.gov terms) and is
two-step: `/points/{lat},{lon}` resolves which forecast grid covers the
location, then `/gridpoints/{wfo}/{x},{y}/forecast/hourly` returns the
forecast.

We hit one point per municipality centroid (78 total) once per hour. Point
lookups are cached on disk for a year; if the cache misses we re-resolve. This
keeps us well within NWS's request limits.

Raw responses always land in R2 first so any later re-parse is reproducible
even if NWS schema shifts.
"""

from __future__ import annotations

import json
import logging
import os
import pathlib
import sys
from datetime import datetime, timezone
from typing import Any

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from ..pipeline.snapshot import save_raw
from ..pipeline.supabase_client import supabase

SOURCE = "api.weather.gov"
UA = os.environ.get("NWS_USER_AGENT") or "islagrid-ai/0.1 (+iantdm11@gmail.com)"
ALERTS_URL = "https://api.weather.gov/alerts/active?area=PR"
POINTS_CACHE = pathlib.Path(__file__).resolve().parents[2] / ".cache" / "nws_points.json"

ALERT_LEVELS = {
    "Extreme": "warning",
    "Severe":  "warning",
    "Moderate": "watch",
    "Minor": "advisory",
    "Unknown": "advisory",
}

log = logging.getLogger(__name__)


def _client() -> httpx.Client:
    return httpx.Client(
        timeout=30.0,
        follow_redirects=True,
        headers={"User-Agent": UA, "Accept": "application/geo+json"},
    )


def _load_points_cache() -> dict[str, dict[str, Any]]:
    if not POINTS_CACHE.exists():
        return {}
    try:
        return json.loads(POINTS_CACHE.read_text())
    except (OSError, json.JSONDecodeError):
        return []  # type: ignore[return-value]


def _save_points_cache(cache: dict[str, dict[str, Any]]) -> None:
    POINTS_CACHE.parent.mkdir(parents=True, exist_ok=True)
    POINTS_CACHE.write_text(json.dumps(cache))


@retry(wait=wait_exponential(min=2, max=20), stop=stop_after_attempt(3), reraise=True)
def _resolve_point(client: httpx.Client, lat: float, lon: float) -> dict[str, Any]:
    r = client.get(f"https://api.weather.gov/points/{lat:.4f},{lon:.4f}")
    r.raise_for_status()
    props = r.json()["properties"]
    return {"forecastHourly": props["forecastHourly"], "office": props["gridId"]}


@retry(wait=wait_exponential(min=2, max=20), stop=stop_after_attempt(3), reraise=True)
def _fetch_hourly(client: httpx.Client, url: str) -> bytes:
    r = client.get(url)
    r.raise_for_status()
    return r.content


def _centroids() -> list[dict[str, Any]]:
    """Pull (municipality_id, lat, lon) for all rows via a Postgres RPC."""
    rows = (
        supabase()
        .rpc("municipality_centroids")  # see migration note below
        .execute()
        .data
    )
    if not rows:
        log.warning("municipality_centroids RPC returned no rows")
        return []
    return rows


def _parse_hourly(body: bytes, ts: datetime) -> dict[str, Any] | None:
    try:
        doc = json.loads(body)
        period = doc["properties"]["periods"][0]
    except (KeyError, IndexError, json.JSONDecodeError):
        return None
    wind = period.get("windSpeed", "")
    # NWS returns wind like "10 to 15 mph"; take the high end.
    mph = 0.0
    for token in wind.replace("to", " ").split():
        try:
            mph = max(mph, float(token))
        except ValueError:
            continue
    return {
        "ts": ts.isoformat(),
        "temp_c": _to_c(period.get("temperature"), period.get("temperatureUnit")),
        "wind_kph": round(mph * 1.609, 2),
        "gust_kph": None,  # hourly endpoint doesn't expose gusts
        "precip_mm": None,
        "prob_precip": (period.get("probabilityOfPrecipitation") or {}).get("value"),
    }


def _to_c(value: float | None, unit: str | None) -> float | None:
    if value is None:
        return None
    if unit and unit.upper() == "F":
        return round((float(value) - 32) * 5 / 9, 1)
    return float(value) if value is not None else None


def _fetch_alerts(client: httpx.Client) -> dict[str, str]:
    """Return {municipality_id: alert_level} for active alerts on PR."""
    try:
        r = client.get(ALERTS_URL)
        r.raise_for_status()
        save_raw(SOURCE, r.content, ext="json", content_type="application/geo+json")
        features = r.json().get("features", [])
    except Exception as exc:
        log.warning("NWS alerts fetch failed: %s", exc)
        return {}
    levels: dict[str, str] = {}
    for f in features:
        sev = (f.get("properties") or {}).get("severity", "Unknown")
        # NWS alerts don't tie to municipality_id directly; we tag *all*
        # municipalities at the same level when an island-wide alert is active.
        # A finer mapping (UGC codes → municipalities) is a future TODO.
        level = ALERT_LEVELS.get(sev, "advisory")
        levels.setdefault("__island__", level)
    return levels


def run() -> int:
    cache = _load_points_cache()
    centroids = _centroids()
    if not centroids:
        return 0

    now = datetime.now(timezone.utc)
    rows: list[dict[str, Any]] = []
    with _client() as client:
        alerts = _fetch_alerts(client)
        island_alert = alerts.get("__island__", "none")
        for row in centroids:
            muni_id = row["id"]
            lat, lon = float(row["lat"]), float(row["lon"])
            try:
                key = f"{lat:.4f},{lon:.4f}"
                if key not in cache:
                    cache[key] = _resolve_point(client, lat, lon)
                body = _fetch_hourly(client, cache[key]["forecastHourly"])
            except Exception as exc:
                log.warning("NWS fetch failed for %s: %s", muni_id, exc)
                continue
            raw_key = save_raw(
                SOURCE, body, ext="json", content_type="application/geo+json"
            )
            parsed = _parse_hourly(body, now)
            if parsed is None:
                continue
            rows.append(
                {
                    **parsed,
                    "municipality_id": muni_id,
                    "alert_level": island_alert,
                    "raw_key": raw_key,
                }
            )
    _save_points_cache(cache)

    if rows:
        supabase().table("weather_snapshots").upsert(
            rows, on_conflict="ts,municipality_id"
        ).execute()
    log.info("nws_weather: wrote %d rows", len(rows))
    return len(rows)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    sys.exit(0 if run() >= 0 else 1)
