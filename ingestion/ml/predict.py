"""
Batch outage-probability inference.

Runs in GitHub Actions on a schedule. Reads the latest features per
municipality, applies the most recent gated model (or the heuristic
when no model passes the Brier-improvement gate), clips probabilities
to [0.05, 0.95], and upserts rows to `outage_predictions`.
"""

from __future__ import annotations

import json
import logging
import pathlib
import sys
from datetime import datetime, timezone
from typing import Any, Callable

import numpy as np

from src.pipeline.supabase_client import supabase  # type: ignore[import-not-found]
from .dataset import FEATURE_COLS

log = logging.getLogger(__name__)

ROOT = pathlib.Path(__file__).resolve().parents[2] / "ml-runs"
HORIZON = "6h"
HORIZON_SECONDS = 6 * 3600


def _latest_run() -> dict[str, Any] | None:
    p = ROOT / "latest.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except json.JSONDecodeError:
        return None


def _load_model(run_id: str) -> tuple[Any, Callable[[np.ndarray], np.ndarray]]:
    # We save only the isotonic regressor's threshold arrays (X_thresholds_,
    # y_thresholds_). Reconstructing a real `IsotonicRegression` from those
    # would need `f_` (a scipy interp1d), which depends on sklearn internals
    # that have changed across versions and crashed predict on prod with
    # `AttributeError: 'IsotonicRegression' object has no attribute 'f_'`.
    # `np.interp` with the saved thresholds is mathematically equivalent to
    # `IsotonicRegression(out_of_bounds="clip").predict` (numpy clamps at
    # the endpoints by default) and has zero sklearn-version coupling.
    import lightgbm as lgb

    run_dir = ROOT / run_id
    booster = lgb.Booster(model_file=str(run_dir / "model.txt"))
    cal_x = np.load(run_dir / "calibrator_x.npy")
    cal_y = np.load(run_dir / "calibrator_y.npy")
    if cal_x.shape != cal_y.shape:
        raise ValueError(
            f"calibrator x/y shape mismatch for run {run_id}: "
            f"{cal_x.shape} vs {cal_y.shape}"
        )
    if cal_x.size < 2:
        raise ValueError(
            f"calibrator for run {run_id} has only {cal_x.size} point(s); "
            "need ≥2 to interpolate"
        )

    def calibrate(raw: np.ndarray) -> np.ndarray:
        return np.interp(raw, cal_x, cal_y)

    return booster, calibrate


def _heuristic_fallback(features: list[dict[str, Any]]) -> list[float]:
    out: list[float] = []
    for f in features:
        weather = max(
            (f.get("wind_kph") or 0) / 80.0,
            (f.get("precip_mm") or 0) / 30.0,
        )
        grid = f.get("grid_stress") or 0.0
        planned = 1.0 if f.get("planned_work_within_24h") else 0.0
        raw = 0.5 * weather + 0.3 * grid + 0.15 * planned
        out.append(float(min(0.95, max(0.05, raw))))
    return out


# Page size for scanning outage_features. PR has 78 munis, so 5000 rows is
# typically ~64 latest rows per muni — plenty to find one fresh row each.
# If the table ever grows so dense that 5000 doesn't cover one row per muni
# we log a warning and page again rather than silently skipping munis.
_FEATURES_PAGE_SIZE = 5000


def _latest_features() -> list[dict[str, Any]]:
    """Return one freshest row per municipality_id.

    Pages through outage_features in 5000-row chunks (desc by ts) until we
    have a row for every muni present OR until we run out. Avoids the silent
    "older munis dropped" failure mode when the table grows large.
    """
    sb = supabase()
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    offset = 0
    while True:
        rows = (
            sb.table("outage_features")
            .select(",".join(["ts", "municipality_id", *FEATURE_COLS]))
            .order("ts", desc=True)
            .range(offset, offset + _FEATURES_PAGE_SIZE - 1)
            .execute()
            .data
        ) or []
        if not rows:
            break
        for row in rows:
            muni = row["municipality_id"]
            if muni in seen:
                continue
            seen.add(muni)
            out.append(row)
        if len(rows) < _FEATURES_PAGE_SIZE:
            break
        offset += _FEATURES_PAGE_SIZE
        # Soft cap so a runaway table can't OOM the runner. 50k rows ≈ ~640
        # newest entries per muni — more than enough for "latest per muni."
        if offset >= 50_000:
            log.warning(
                "_latest_features: scanned %d rows without exhausting; %d munis covered",
                offset,
                len(seen),
            )
            break
    return out


def _confidence_band(prob: float) -> str:
    if 0.4 <= prob <= 0.6:
        return "low"
    if 0.2 <= prob < 0.4 or 0.6 < prob <= 0.8:
        return "medium"
    return "high"


def run() -> int:
    rows = _latest_features()
    if not rows:
        log.warning("No features in outage_features; skipping inference.")
        return 0

    now = datetime.now(timezone.utc)
    latest = _latest_run()
    use_model = bool(latest and latest.get("passed_gate"))
    booster = calibrator = None
    if use_model:
        try:
            booster, calibrator = _load_model(latest["run"])  # type: ignore[index]
        except Exception as exc:  # noqa: BLE001
            log.warning("Model load failed (%s); falling back to heuristic.", exc)
            use_model = False

    if use_model:
        # Preserve NaN for genuinely-missing values rather than coercing to 0.
        # LightGBM was trained with NaN-aware splits; feeding zeros now would
        # route every missing-weather row down the wrong branch.
        def _cell(v: Any) -> float:
            try:
                return float(v) if v is not None else float("nan")
            except (TypeError, ValueError):
                return float("nan")

        X = np.array(
            [[_cell(r.get(c)) for c in FEATURE_COLS] for r in rows],
            dtype=float,
        )
        raw = booster.predict(X)  # type: ignore[union-attr]
        probs = np.clip(calibrator(raw), 0.05, 0.95)  # type: ignore[misc]
        model_version = latest["run"]  # type: ignore[index]
    else:
        probs = np.array(_heuristic_fallback(rows))
        model_version = f"heuristic:v1-{now.strftime('%Y%m%d')}"

    payload = []
    skipped_parse = 0
    for row, prob in zip(rows, probs):
        # Tolerate mixed-microsecond ISO timestamps (live cron writes
        # `...:00+00:00`, backfill writes `...:00.057693+00:00`). A bad row
        # shouldn't kill the whole run — log and skip.
        try:
            feature_ts = datetime.fromisoformat(str(row["ts"]).replace("Z", "+00:00"))
        except ValueError:
            skipped_parse += 1
            continue
        freshness_s = int((now - feature_ts).total_seconds())
        # Honesty rail: stale features get no published prediction.
        if freshness_s > 2 * HORIZON_SECONDS:
            continue
        payload.append(
            {
                "ts": now.isoformat(),
                "municipality_id": row["municipality_id"],
                "horizon": HORIZON,
                "probability": float(prob),
                "confidence_band": _confidence_band(float(prob)),
                "top_factors": _explain(row),
                "model_version": model_version,
                "feature_freshness_s": freshness_s,
            }
        )

    if skipped_parse:
        log.warning("outage_predictions: skipped %d rows with unparseable ts", skipped_parse)

    if payload:
        # Upsert failures must surface — silently swallowing them publishes
        # nothing while logging a confident success line, hiding real outages
        # from the dashboard.
        try:
            supabase().table("outage_predictions").upsert(
                payload, on_conflict="ts,municipality_id,horizon"
            ).execute()
        except Exception as exc:
            log.error(
                "outage_predictions upsert failed (%d rows, model_version=%s): %s",
                len(payload),
                model_version,
                exc,
            )
            raise
    log.info("outage_predictions: wrote %d rows (model_version=%s)", len(payload), model_version)
    return len(payload)


def _explain(row: dict[str, Any]) -> list[dict[str, str | float]]:
    """Cheap, rule-based 'top factors' so the UI always has reasons even when
    we're on the heuristic path or before SHAP is wired up."""
    factors: list[tuple[str, float]] = []
    if (row.get("wind_kph") or 0) > 30:
        factors.append(("High wind forecast", float(row["wind_kph"])))
    if (row.get("precip_mm") or 0) > 5:
        factors.append(("Heavy precipitation expected", float(row["precip_mm"])))
    if (row.get("alert_level") or "none") in ("watch", "warning"):
        factors.append((f"Active NWS {row['alert_level']}", 1.0))
    if (row.get("grid_stress") or 0) > 0.5:
        factors.append(("Island reserves are tight", float(row["grid_stress"])))
    if row.get("planned_work_within_24h"):
        factors.append(("Planned work nearby in next 24h", 1.0))
    return [{"label": label, "weight": round(w, 2)} for label, w in factors[:5]]


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    sys.exit(0 if run() >= 0 else 1)
