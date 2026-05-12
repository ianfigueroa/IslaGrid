"""
NHC active-storm advisory ingest.

Uses the ``tropycal`` library to read NHC's real-time advisory feed for the
Atlantic basin. For every currently active storm we persist:

  * forecast track (LineString GeoJSON)
  * 5-day forecast cone (Polygon GeoJSON)
  * intensity (Saffir-Simpson category, max wind kt, min pressure mb)
  * the advisory's forecast_made_at timestamp

NHC issues advisories on a 6-hour cadence during active storms. We run this
job hourly so we pick up new advisories within an hour of publication. When
no Atlantic storms are active the job exits cleanly with zero rows.

Light dependency on ``tropycal`` (only the realtime module). If the import
fails we log loudly and exit 0 so the rest of the workflow keeps running.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any

from ..pipeline.supabase_client import supabase

SOURCE = "nhc-hurdat"
log = logging.getLogger(__name__)


def _try_import_tropycal() -> Any | None:
    try:
        import tropycal.realtime as realtime  # type: ignore[import-not-found]

        return realtime
    except Exception as exc:  # noqa: BLE001
        log.warning("tropycal not available (%s) — hurricane ingest skipped", exc)
        return None


def _cone_geojson(storm: Any) -> dict[str, Any] | None:
    """Return the 5-day forecast cone as a GeoJSON Polygon, or None."""
    try:
        cone = storm.get_forecast_realtime(ssl_certificate=False)
    except Exception:  # noqa: BLE001
        return None
    # tropycal's storm.get_realtime_formatted_cone() returns a dict with
    # 'cone_2d' (lon/lat coords) when available; fall through cleanly when
    # tropycal can't compute it.
    try:
        cone_dict = storm.get_realtime_formatted_cone()
    except Exception:  # noqa: BLE001
        return None
    if not cone_dict or "cone_2d" not in cone_dict:
        return None
    coords = cone_dict["cone_2d"]
    if not coords:
        return None
    # GeoJSON expects [[ [lon,lat], [lon,lat], ... ]] for a single Polygon ring.
    ring = [[float(lon), float(lat)] for lon, lat in coords]
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    return {"type": "Polygon", "coordinates": [ring]}


def _track_geojson(storm: Any) -> dict[str, Any] | None:
    try:
        lons = list(storm.dict.get("lon") or [])
        lats = list(storm.dict.get("lat") or [])
    except Exception:  # noqa: BLE001
        return None
    if len(lons) != len(lats) or len(lons) < 2:
        return None
    return {
        "type": "LineString",
        "coordinates": [[float(lo), float(la)] for lo, la in zip(lons, lats)],
    }


def _category(max_wind_kt: float | None) -> int | None:
    if max_wind_kt is None:
        return None
    if max_wind_kt < 34:
        return -1  # tropical depression
    if max_wind_kt < 64:
        return 0  # tropical storm
    if max_wind_kt < 83:
        return 1
    if max_wind_kt < 96:
        return 2
    if max_wind_kt < 113:
        return 3
    if max_wind_kt < 137:
        return 4
    return 5


def run() -> int:
    realtime = _try_import_tropycal()
    if realtime is None:
        return 0

    try:
        rt = realtime.Realtime()
    except Exception as exc:  # noqa: BLE001
        log.warning("tropycal.Realtime() failed (%s) — skipping", exc)
        return 0

    now_iso = datetime.now(timezone.utc).isoformat()
    rows: list[dict[str, Any]] = []
    active_storms = []
    try:
        active_storms = rt.list_active_storms(basin="north_atlantic")
    except Exception as exc:  # noqa: BLE001
        log.warning("list_active_storms failed (%s)", exc)
        return 0

    for storm_id in active_storms:
        try:
            storm = rt.get_storm(storm_id)
        except Exception as exc:  # noqa: BLE001
            log.warning("get_storm(%s) failed: %s", storm_id, exc)
            continue
        # max_wind / min_pressure are typed as lists of recent observations
        try:
            max_wind = max((w for w in storm.dict.get("vmax", []) if w), default=None)
            min_pres = min((p for p in storm.dict.get("mslp", []) if p), default=None)
        except Exception:  # noqa: BLE001
            max_wind, min_pres = None, None

        rows.append(
            {
                "storm_id": storm.id,
                "storm_name": getattr(storm, "name", None) or storm.id,
                "basin": "atlantic",
                "forecast_made_at": now_iso,
                "category": _category(max_wind),
                "max_wind_kt": int(max_wind) if max_wind is not None else None,
                "min_pressure_mb": int(min_pres) if min_pres is not None else None,
                "track_geojson": _track_geojson(storm),
                "cone_geojson": _cone_geojson(storm),
                "active": True,
                "source": SOURCE,
                "raw_key": None,
            }
        )

    if not rows:
        log.info("nhc_hurdat: no active Atlantic storms")
        # Mark any previously-active storms as inactive — the absence of a row
        # in list_active_storms() is the canonical "storm dissipated" signal.
        try:
            supabase().table("hurricane_forecasts").update({"active": False}).neq(
                "storm_id", "_sentinel"
            ).eq("active", True).execute()
        except Exception as exc:  # noqa: BLE001
            log.warning("deactivate-stale failed: %s", exc)
        return 0

    # Upsert by (storm_id, forecast_made_at) to keep the time-series intact.
    try:
        supabase().table("hurricane_forecasts").upsert(
            rows, on_conflict="storm_id,forecast_made_at"
        ).execute()
    except Exception as exc:  # noqa: BLE001
        log.error("hurricane_forecasts upsert failed: %s", exc)
        return 0

    log.info("nhc_hurdat: wrote %d active-storm rows", len(rows))
    # Log the GeoJSON payload size for debugging the cone parser.
    for r in rows:
        if r["cone_geojson"]:
            log.debug("storm %s cone has %d points", r["storm_id"], len(json.dumps(r["cone_geojson"])))
    return len(rows)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    sys.exit(0 if run() >= 0 else 1)
