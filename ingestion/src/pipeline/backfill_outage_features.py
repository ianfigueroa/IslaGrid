"""
Backfill `outage_features` rows for historical labels so the LightGBM
trainer can actually use them.

Why this exists:
  - `outage_labels` now has ~1,100 Eagle-i events from 2023–2025.
  - The trainer joins labels × features by (municipality_id, ts ±6h).
  - But `outage_features` only contains rows from the live `predict-outage`
    cron (~last 3 weeks). Every historical label has no matching feature
    row, so the trainer can't see them.
  - Result: trainer falls back to heuristic because <50 positive train pairs.

What we generate per historical label:
  - Temporal features (hour_of_day, day_of_week, month)  — trivial
  - Static features per muni (distance_to_nearest_plant_km, elevation_m)
  - grid_stress proxied from the closest LUMA archive snapshot in the
    same operating region within ±48h of the label
  - recent_outages_7d  — count of other labels for this muni in past 7d
  - Weather fields stay NULL (LightGBM/fillna handle missing). Adding
    weather requires Open-Meteo's archive API; that's a follow-up.

We also generate **negative** feature rows so the trainer sees y=0 too.
For each muni we sample ~5x as many random timestamps across the label
window, skip any within ±6h of a real label, and emit a row at each.

Idempotent: tags rows with `source='backfill'` in a sidecar column (the
column doesn't exist on outage_features; we instead delete-and-replace
rows whose ts is BEFORE the live cron started, identified by an
environment variable threshold).
"""

from __future__ import annotations

import argparse
import logging
import math
import random
import sys
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any, Iterable

from .supabase_client import supabase

log = logging.getLogger(__name__)

NEGATIVE_RATIO = 5  # negatives per positive, per muni
LABEL_WINDOW_HOURS = 6  # mirrors LABEL_HORIZON_HOURS in ml/dataset.py
GRID_STRESS_WINDOW_HOURS = 48
# Anything older than this we treat as "the backfill window"; rows in here
# are wiped + replaced on every run. Live cron writes anything newer.
BACKFILL_HORIZON_DAYS = 14

# Mirror lib/luma-regions.ts so we can map muni → LUMA region in Python.
MUNI_TO_REGION: dict[str, str] = {}
LUMA_REGIONS: dict[str, list[str]] = {
    "San Juan": ["san-juan"],
    "Bayamón": [
        "bayamon", "toa-alta", "toa-baja", "catano", "guaynabo",
        "comerio", "naranjito", "corozal", "vega-alta", "dorado",
    ],
    "Carolina": [
        "carolina", "trujillo-alto", "loiza", "rio-grande", "canovanas",
        "luquillo", "fajardo", "ceiba", "vieques", "culebra",
    ],
    "Caguas": [
        "caguas", "aguas-buenas", "san-lorenzo", "gurabo", "juncos",
        "las-piedras", "humacao", "naguabo", "yabucoa", "maunabo",
        "cidra", "cayey", "aibonito", "barranquitas",
    ],
    "Mayagüez": [
        "mayaguez", "hormigueros", "san-german", "cabo-rojo", "lajas",
        "sabana-grande", "maricao", "las-marias", "anasco", "rincon",
        "aguada", "aguadilla", "moca", "san-sebastian",
    ],
    "Ponce": [
        "ponce", "adjuntas", "jayuya", "juana-diaz", "santa-isabel",
        "coamo", "salinas", "villalba", "guayanilla", "penuelas",
        "yauco", "guanica",
    ],
    "Arecibo": [
        "arecibo", "camuy", "quebradillas", "isabela", "lares", "utuado",
        "hatillo", "manati", "vega-baja", "florida", "ciales",
        "barceloneta", "morovis", "orocovis",
    ],
}
for _region, _munis in LUMA_REGIONS.items():
    for _muni in _munis:
        MUNI_TO_REGION[_muni] = _region


def _region_to_archive_id(region_name: str) -> str:
    """Match the region_id used in luma_outage_snapshots (lowercased, hyphens)."""
    return region_name.lower().replace(" ", "-").replace("ñ", "n").replace("ü", "u")


def _haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Great-circle distance between two (lon, lat) pairs."""
    (lon1, lat1), (lon2, lat2) = a, b
    rlat1, rlat2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    h = (
        math.sin(dlat / 2) ** 2
        + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlon / 2) ** 2
    )
    return 2 * 6371.0 * math.asin(math.sqrt(h))


def _load_muni_centroids() -> dict[str, tuple[float, float]]:
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


def _load_plants_coords() -> list[tuple[float, float]]:
    """Read the curated plant list from the TS file by importing the runtime
    JSON we ship alongside it. Falls back to a small hardcoded list — better
    than no distance feature."""
    # Hard-code the 7 largest plant coords (Genera fleet + IPPs). Smaller
    # peakers shift the nearest-plant distance trivially; not worth the
    # build-time complexity of parsing the TS file.
    return [
        (-66.108, 18.452),  # San Juan
        (-66.140, 18.451),  # Palo Seco
        (-66.762, 17.985),  # Costa Sur
        (-66.224, 17.953),  # Aguirre
        (-66.115, 17.943),  # AES Guayama
        (-66.778, 17.974),  # EcoEléctrica
        (-67.180, 18.215),  # Mayagüez
        (-66.660, 18.479),  # Cambalache
    ]


def _muni_nearest_plant_km(
    centroids: dict[str, tuple[float, float]],
    plants: list[tuple[float, float]],
) -> dict[str, float]:
    out: dict[str, float] = {}
    for muni, c in centroids.items():
        out[muni] = min(_haversine_km(c, p) for p in plants)
    return out


def _load_labels(window_start: datetime) -> list[dict[str, Any]]:
    """Page through outage_labels — PostgREST caps at 1000 rows/request."""
    sb = supabase()
    page = 1000
    offset = 0
    rows: list[dict[str, Any]] = []
    while True:
        chunk = (
            sb.table("outage_labels")
            .select("municipality_id, started_at, severity, source, confidence")
            .gte("started_at", window_start.isoformat())
            .order("started_at", desc=False)
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


def _load_luma_archive() -> list[dict[str, Any]]:
    """All LUMA region snapshots — both archive + live feeds."""
    sb = supabase()
    page = 1000
    offset = 0
    rows: list[dict[str, Any]] = []
    while True:
        chunk = (
            sb.table("luma_outage_snapshots")
            .select("ts, region_id, customers_affected, customers_served")
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


def _index_luma_by_region(
    rows: list[dict[str, Any]],
) -> dict[str, list[tuple[datetime, float]]]:
    """Build {region_id: sorted [(ts, stress), ...]} for closest-time lookup.

    grid_stress = customers_affected / max(customers_served, 1), clipped 0..1.
    Mapping is intentionally coarse — the absolute number doesn't matter,
    only the relative spike pattern."""
    by_region: dict[str, list[tuple[datetime, float]]] = defaultdict(list)
    for r in rows:
        region = (r.get("region_id") or "").lower()
        ts_raw = r.get("ts")
        if not region or not ts_raw:
            continue
        try:
            ts = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))
        except ValueError:
            continue
        affected = r.get("customers_affected") or 0
        served = max(int(r.get("customers_served") or 0), 1)
        stress = min(1.0, max(0.0, affected / served * 20.0))  # 5% → 1.0
        by_region[region].append((ts, stress))
    for region in by_region:
        by_region[region].sort(key=lambda x: x[0])
    return by_region


def _grid_stress_at(
    indexed: dict[str, list[tuple[datetime, float]]],
    muni_id: str,
    ts: datetime,
) -> float | None:
    region = MUNI_TO_REGION.get(muni_id)
    if not region:
        return None
    series = indexed.get(_region_to_archive_id(region))
    if not series:
        return None
    # Linear scan back from the closest ts — series is small enough (≤ a few
    # thousand) per region that bisecting isn't worth the complexity.
    cutoff = timedelta(hours=GRID_STRESS_WINDOW_HOURS)
    closest: tuple[datetime, float] | None = None
    for sample_ts, stress in series:
        if abs(sample_ts - ts) > cutoff:
            continue
        if closest is None or abs(sample_ts - ts) < abs(closest[0] - ts):
            closest = (sample_ts, stress)
    return closest[1] if closest else None


def _temporal(ts: datetime) -> dict[str, int]:
    return {
        "hour_of_day": ts.hour,
        "day_of_week": ts.weekday(),
        "month": ts.month,
    }


def _build_positives(
    labels: list[dict[str, Any]],
    centroids: dict[str, tuple[float, float]],
    distances: dict[str, float],
    luma_indexed: dict[str, list[tuple[datetime, float]]],
    recent_count: dict[tuple[str, str], int],
) -> list[dict[str, Any]]:
    """One feature row per label, timestamped at the label's start."""
    rows: list[dict[str, Any]] = []
    for label in labels:
        muni = label.get("municipality_id")
        ts_raw = label.get("started_at")
        if not muni or not ts_raw or muni not in centroids:
            continue
        try:
            ts = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))
        except ValueError:
            continue
        date_key = ts.date().isoformat()
        rows.append(
            {
                "ts": ts.isoformat(),
                "municipality_id": muni,
                "grid_stress": _grid_stress_at(luma_indexed, muni, ts),
                "planned_work_within_24h": False,
                "recent_outages_7d": recent_count.get((muni, date_key), 0),
                "distance_to_nearest_plant_km": distances.get(muni),
                "elevation_m": None,
                **_temporal(ts),
            }
        )
    return rows


def _build_negatives(
    labels: list[dict[str, Any]],
    centroids: dict[str, tuple[float, float]],
    distances: dict[str, float],
    luma_indexed: dict[str, list[tuple[datetime, float]]],
    recent_count: dict[tuple[str, str], int],
) -> list[dict[str, Any]]:
    """Random (muni, ts) negatives sampled across the label window.

    Sampling strategy:
      - Window = [min(label.started_at), max(label.started_at)]
      - Per muni, sample NEGATIVE_RATIO × (#labels for that muni) tries
      - Reject ts within ±LABEL_WINDOW_HOURS of any real label for that muni
      - Cap accepted negatives at the sample budget so noisy munis don't
        dominate the negative class.
    """
    if not labels:
        return []
    label_ts_by_muni: dict[str, list[datetime]] = defaultdict(list)
    for label in labels:
        muni = label.get("municipality_id")
        ts_raw = label.get("started_at")
        if not muni or not ts_raw:
            continue
        try:
            ts = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))
        except ValueError:
            continue
        label_ts_by_muni[muni].append(ts)
    for muni in label_ts_by_muni:
        label_ts_by_muni[muni].sort()

    all_ts: list[datetime] = []
    for v in label_ts_by_muni.values():
        all_ts.extend(v)
    if not all_ts:
        return []
    window_start = min(all_ts)
    window_end = max(all_ts)
    window_span = (window_end - window_start).total_seconds()
    rng = random.Random(42)
    reject_window = timedelta(hours=LABEL_WINDOW_HOURS)

    out: list[dict[str, Any]] = []
    for muni, label_times in label_ts_by_muni.items():
        if muni not in centroids:
            continue
        budget = NEGATIVE_RATIO * len(label_times)
        attempts = 0
        accepted = 0
        # Cap attempts at 4x budget so a muni with very dense label coverage
        # doesn't burn forever rejecting samples.
        while accepted < budget and attempts < budget * 4:
            attempts += 1
            offset = rng.random() * window_span
            ts = window_start + timedelta(seconds=offset)
            if any(abs(ts - lt) <= reject_window for lt in label_times):
                continue
            date_key = ts.date().isoformat()
            out.append(
                {
                    "ts": ts.isoformat(),
                    "municipality_id": muni,
                    "grid_stress": _grid_stress_at(luma_indexed, muni, ts),
                    "planned_work_within_24h": False,
                    "recent_outages_7d": recent_count.get((muni, date_key), 0),
                    "distance_to_nearest_plant_km": distances.get(muni),
                    "elevation_m": None,
                    **_temporal(ts),
                }
            )
            accepted += 1
    return out


def _recent_counts(labels: list[dict[str, Any]]) -> dict[tuple[str, str], int]:
    """For each (muni, date), how many labels started in the previous 7 days."""
    by_muni: dict[str, list[datetime]] = defaultdict(list)
    for label in labels:
        muni = label.get("municipality_id")
        ts_raw = label.get("started_at")
        if not muni or not ts_raw:
            continue
        try:
            ts = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))
        except ValueError:
            continue
        by_muni[muni].append(ts)
    for v in by_muni.values():
        v.sort()
    out: dict[tuple[str, str], int] = {}
    seven = timedelta(days=7)
    for muni, times in by_muni.items():
        # Two pointers — for each date in the window, count labels in the
        # preceding 7 days.
        # Use date keys from each label's date.
        for ts in times:
            day_key = ts.date().isoformat()
            count = sum(1 for t in times if 0 < (ts - t).total_seconds() <= seven.total_seconds())
            # Keep the max count for that date (an active outage day may
            # have multiple labels at different timestamps).
            out[(muni, day_key)] = max(out.get((muni, day_key), 0), count)
    return out


def _wipe_backfill_window(cutoff: datetime) -> None:
    """Delete pre-cutoff feature rows so we can rewrite them cleanly."""
    sb = supabase()
    sb.table("outage_features").delete().lt("ts", cutoff.isoformat()).execute()


def _insert(rows: list[dict[str, Any]], batch_size: int = 500) -> int:
    if not rows:
        return 0
    sb = supabase()
    written = 0
    for start in range(0, len(rows), batch_size):
        chunk = rows[start : start + batch_size]
        try:
            sb.table("outage_features").upsert(
                chunk, on_conflict="ts,municipality_id"
            ).execute()
        except Exception as e:
            log.error(
                "backfill_outage_features: upsert failed at offset %d size %d: %s",
                start,
                len(chunk),
                e,
            )
            raise
        written += len(chunk)
        if (start // batch_size) % 10 == 0:
            log.info("Inserted %d / %d feature rows…", written, len(rows))
    return written


def run() -> int:
    sb = supabase()  # noqa: F841 — fail-fast on missing env
    cutoff = datetime.now(UTC) - timedelta(days=BACKFILL_HORIZON_DAYS)

    log.info("Loading centroids + plants + LUMA archive + labels…")
    centroids = _load_muni_centroids()
    distances = _muni_nearest_plant_km(centroids, _load_plants_coords())
    luma_rows = _load_luma_archive()
    luma_indexed = _index_luma_by_region(luma_rows)
    labels = _load_labels(window_start=datetime(2023, 1, 1, tzinfo=UTC))
    log.info(
        "Loaded %d centroids, %d luma rows, %d labels (window-wide)",
        len(centroids),
        len(luma_rows),
        len(labels),
    )

    # Only use labels that fall inside the backfill window — anything newer
    # the live cron will eventually cover and we don't want to clobber it.
    backfill_labels = [
        l
        for l in labels
        if datetime.fromisoformat(str(l["started_at"]).replace("Z", "+00:00"))
        < cutoff
    ]
    log.info("Backfill window holds %d labels", len(backfill_labels))

    recent = _recent_counts(backfill_labels)
    positives = _build_positives(
        backfill_labels, centroids, distances, luma_indexed, recent
    )
    negatives = _build_negatives(
        backfill_labels, centroids, distances, luma_indexed, recent
    )
    log.info(
        "Synthesized %d positive + %d negative feature rows",
        len(positives),
        len(negatives),
    )

    _wipe_backfill_window(cutoff)
    log.info("Wiped pre-cutoff outage_features rows")

    written_pos = _insert(positives)
    written_neg = _insert(negatives)
    log.info(
        "backfill_outage_features: done; wrote %d positives + %d negatives",
        written_pos,
        written_neg,
    )
    return written_pos + written_neg


def main() -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    return run()


if __name__ == "__main__":
    sys.exit(0 if main() >= 0 else 1)
