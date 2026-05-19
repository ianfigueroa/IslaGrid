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
from typing import Any

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


def _load_model(run_id: str):
    import lightgbm as lgb
    from sklearn.isotonic import IsotonicRegression

    run_dir = ROOT / run_id
    booster = lgb.Booster(model_file=str(run_dir / "model.txt"))
    cal = IsotonicRegression(out_of_bounds="clip")
    cal.X_thresholds_ = np.load(run_dir / "calibrator_x.npy")
    cal.y_thresholds_ = np.load(run_dir / "calibrator_y.npy")
    cal.X_min_ = cal.X_thresholds_[0]
    cal.X_max_ = cal.X_thresholds_[-1]
    cal._build_f = lambda *a, **k: None  # type: ignore[attr-defined]
    return booster, cal


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


def _latest_features() -> list[dict[str, Any]]:
    rows = (
        supabase()
        .table("outage_features")
        .select(",".join(["ts", "municipality_id", *FEATURE_COLS]))
        .order("ts", desc=True)
        .limit(5000)
        .execute()
        .data
    ) or []
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for row in rows:
        muni = row["municipality_id"]
        if muni in seen:
            continue
        seen.add(muni)
        out.append(row)
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
        probs = np.clip(calibrator.predict(raw), 0.05, 0.95)  # type: ignore[union-attr]
        model_version = latest["run"]  # type: ignore[index]
    else:
        probs = np.array(_heuristic_fallback(rows))
        model_version = f"heuristic:v1-{now.strftime('%Y%m%d')}"

    payload = []
    for row, prob in zip(rows, probs):
        feature_ts = datetime.fromisoformat(str(row["ts"]).replace("Z", "+00:00"))
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

    if payload:
        supabase().table("outage_predictions").upsert(
            payload, on_conflict="ts,municipality_id,horizon"
        ).execute()
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
