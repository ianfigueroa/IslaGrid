"""
Merge per-source grid snapshots into one authoritative row.

No single upstream has the whole picture:

  - lumapr.com (Resumen del Sistema)  -> current/next demand, reserves, peaks
  - genera-pr.com (Data Generación)   -> total generation, available capacity,
                                          spinning + operational reserve
  - luma-outage-map (MiLUMA API)      -> customers without service (context)

This module reads the most recent row from each source in `grid_snapshots`,
picks the best-available value for every field by source priority, re-runs the
`classify()` heuristic on the merged inputs, and writes a single row with
`source = 'islagrid-merged'`. Because it runs last in the ingest cycle the
merged row has the newest `ts`, so `/api/grid/status` (which selects
`order by ts desc limit 1`) naturally serves it.

Field priority (first non-null wins):
  current_demand_mw       lumapr.com  > genera-pr.com
  next_hour_demand_mw     lumapr.com  > genera-pr.com
  total_generation_mw     genera-pr.com > lumapr.com
  available_capacity_mw   genera-pr.com > lumapr.com
  spinning_reserve_mw     genera-pr.com
  operational_reserve_mw  genera-pr.com > lumapr.com
  peak_demand_forecast_mw lumapr.com  > genera-pr.com
  peak_reserve_forecast_mw lumapr.com > genera-pr.com

A merged row is only "stale" when EVERY contributing source was stale — one
healthy source is enough to give the public a real number.
"""

from __future__ import annotations

import logging
import sys
from datetime import UTC, datetime
from typing import Any

from .risk import GridInputs, classify
from .supabase_client import supabase

MERGED_SOURCE = "islagrid-merged"
# Sources we merge, newest-first lookup. Order here does not imply priority —
# priority is per-field, see FIELD_PRIORITY below.
COMPONENT_SOURCES = ("lumapr.com", "genera-pr.com")

# field -> ordered list of sources to try
FIELD_PRIORITY: dict[str, tuple[str, ...]] = {
    "current_demand_mw": ("lumapr.com", "genera-pr.com"),
    "next_hour_demand_mw": ("lumapr.com", "genera-pr.com"),
    "total_generation_mw": ("genera-pr.com", "lumapr.com"),
    "available_capacity_mw": ("genera-pr.com", "lumapr.com"),
    "spinning_reserve_mw": ("genera-pr.com",),
    "operational_reserve_mw": ("genera-pr.com", "lumapr.com"),
    "peak_demand_forecast_mw": ("lumapr.com", "genera-pr.com"),
    "peak_reserve_forecast_mw": ("lumapr.com", "genera-pr.com"),
}

log = logging.getLogger(__name__)


def _latest_per_source() -> dict[str, dict[str, Any]]:
    """Most recent grid_snapshots row for each component source."""
    out: dict[str, dict[str, Any]] = {}
    for src in COMPONENT_SOURCES:
        res = (
            supabase()
            .table("grid_snapshots")
            .select("*")
            .eq("source", src)
            .order("ts", desc=True)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if rows:
            out[src] = rows[0]
    return out


def _pick(field: str, by_source: dict[str, dict[str, Any]]) -> tuple[float | None, str | None]:
    """First non-null value for `field` across the field's source priority."""
    for src in FIELD_PRIORITY.get(field, COMPONENT_SOURCES):
        row = by_source.get(src)
        if row is None:
            continue
        val = row.get(field)
        if val is not None:
            return float(val), src
    return None, None


def run() -> int:
    by_source = _latest_per_source()
    if not by_source:
        log.warning("merge_grid: no component snapshots found — nothing to merge")
        return 0

    merged: dict[str, float | None] = {}
    contributors: dict[str, str] = {}
    for field in FIELD_PRIORITY:
        val, src = _pick(field, by_source)
        merged[field] = val
        if src:
            contributors[field] = src

    # Merged row is stale only when every contributing source was stale.
    all_stale = all(
        bool(row.get("source_stale")) for row in by_source.values()
    )

    verdict = classify(
        GridInputs(
            current_demand_mw=merged["current_demand_mw"],
            next_hour_demand_mw=merged["next_hour_demand_mw"],
            available_capacity_mw=merged["available_capacity_mw"],
            operational_reserve_mw=merged["operational_reserve_mw"],
            spinning_reserve_mw=merged["spinning_reserve_mw"],
            source_stale=all_stale,
        )
    )

    used = sorted(set(contributors.values()))
    reasons = list(verdict.reasons)
    reasons.append(
        f"Merged from {', '.join(used)}" if used else "No component sources had data"
    )

    row = {
        "ts": datetime.now(UTC).isoformat(),
        "current_demand_mw": merged["current_demand_mw"],
        "next_hour_demand_mw": merged["next_hour_demand_mw"],
        "total_generation_mw": merged["total_generation_mw"],
        "available_capacity_mw": merged["available_capacity_mw"],
        "spinning_reserve_mw": merged["spinning_reserve_mw"],
        "operational_reserve_mw": merged["operational_reserve_mw"],
        "peak_demand_forecast_mw": merged["peak_demand_forecast_mw"],
        "peak_reserve_forecast_mw": merged["peak_reserve_forecast_mw"],
        "status": verdict.status,
        "status_reasons": reasons,
        "source": MERGED_SOURCE,
        "source_stale": all_stale,
        "raw_key": None,
    }
    supabase().table("grid_snapshots").insert(row).execute()
    log.info(
        "merge_grid: wrote merged row status=%s demand=%s gen=%s avail=%s sources=%s",
        verdict.status,
        merged["current_demand_mw"],
        merged["total_generation_mw"],
        merged["available_capacity_mw"],
        used,
    )
    return 1


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    sys.exit(0 if run() >= 0 else 1)
