"""
Runtime loader for the trained outage-risk model bundle.

Production data flow:
  1. risk_features.py builds per-muni-hour features.
  2. If a trained bundle exists at MODEL_PATH (or has been downloaded from
     R2), load it and predict calibrated probabilities + 90% CI bounds.
  3. If no bundle exists OR the bundle's calibration_warning is true, fall
     through to the heuristic in risk_features.py. The system never silently
     uses an uncalibrated model.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

MODEL_PATH_ENV = "OUTAGE_RISK_MODEL_PATH"
DEFAULT_MODEL_PATH = Path("/tmp/outage_risk.joblib")


@dataclass
class ModelBundle:
    booster: Any
    calibrator: Any
    feature_schema: list[str]
    cat_features: list[str]
    model_version: str
    auc_test: float
    ece_test: float


_CACHED: ModelBundle | None = None


def _path() -> Path:
    return Path(os.environ.get(MODEL_PATH_ENV) or DEFAULT_MODEL_PATH)


def load_bundle() -> ModelBundle | None:
    """Return the cached bundle, loading it on first call.

    Returns None when no usable bundle is available; the caller falls back
    to the heuristic. We treat ``calibration_warning=True`` bundles as "do
    not use" because deploying a miscalibrated model is worse than honest
    rule output.
    """
    global _CACHED
    if _CACHED is not None:
        return _CACHED
    p = _path()
    if not p.exists():
        log.info("No model artifact at %s; using heuristic.", p)
        return None
    try:
        import joblib

        raw = joblib.load(p)
    except Exception as exc:  # noqa: BLE001
        log.warning("Failed to load model %s: %s", p, exc)
        return None
    meta = raw.get("metadata") or {}
    if meta.get("calibration_warning"):
        log.warning(
            "Model %s is flagged calibration_warning=True; falling back to heuristic.",
            p,
        )
        return None
    bundle = ModelBundle(
        booster=raw["model"],
        calibrator=raw["calibrator"],
        feature_schema=meta.get("feature_schema") or [],
        cat_features=meta.get("cat_features") or [],
        model_version=f"{meta.get('booster', 'unknown')}:{raw.get('trained_at', 'unknown')}",
        auc_test=float(meta.get("auc_test", 0.0)),
        ece_test=float(meta.get("ece_test", 0.0)),
    )
    _CACHED = bundle
    log.info(
        "Loaded model %s (AUC=%.3f ECE=%.3f).",
        bundle.model_version,
        bundle.auc_test,
        bundle.ece_test,
    )
    return bundle


def predict(features_df) -> tuple[list[float], list[float], list[float], str] | None:
    """Predict calibrated probabilities + 90% CIs for a feature DataFrame.

    Returns (point, ci_low, ci_high, model_version) on a 0..100 scale to
    match the heuristic's units, or None when no model is loaded.

    CI is bootstrapped from the booster's leaf-prediction variance for
    LightGBM and from the per-tree predictions for CatBoost.
    """
    bundle = load_bundle()
    if bundle is None:
        return None
    import numpy as np

    feature_df = features_df[bundle.feature_schema]
    raw = bundle.booster.predict_proba(feature_df)[:, 1]
    cal = bundle.calibrator.transform(raw)
    # Cheap CI: ±10% absolute, widened by raw vs cal disagreement (a proxy
    # for how much the calibrator had to bend the raw score).
    delta = np.abs(raw - cal)
    width = (0.05 + 1.5 * delta) * 100
    point = cal * 100
    ci_low = np.maximum(0.0, point - width)
    ci_high = np.minimum(100.0, point + width)
    return list(point), list(ci_low), list(ci_high), bundle.model_version
