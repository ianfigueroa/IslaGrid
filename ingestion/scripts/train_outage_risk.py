"""
Offline trainer for the outage-risk model + isotonic calibration.

We benchmark two boosters on the same temporal split and ship the winner:

  * **LightGBM** — primary. Fast, native missing-value handling, the
    standard in 2024-2025 power-outage prediction literature.
  * **CatBoost** — challenger. Strong on tabular data with many categorical
    features (municipality id, alert level, fuel type, etc.); often wins
    benchmarks but trains slower. The trainer runs both, compares AUC on
    the validation fold, and keeps whichever wins.

Both get an isotonic calibrator on top fit against the calibration fold.
The exported `.joblib` bundle records which booster won + its AUC + ECE,
so production loads only the best artifact.

Run manually after the data archive is large enough; the production pipeline
keeps using the heuristic until a trained `.joblib` lands in R2 under
`models/outage_risk/<version>.joblib`.

Honest accuracy expectations (see docs/MODEL_REPORT.md):
  * 1-6h horizon: AUC ~0.75-0.85 once we have the EAGLE-I + Wayback backfill
  * 6-24h horizon: AUC 0.65-0.72; surfaced as "trend, not prediction"
  * >24h: not modeled — we surface the storm prior + forecast and leave the
    inference to the reader. Refusing to fabricate probabilities is the
    point.

Data sources (all official, no synthetic data, no third-party scrapers):
  1. **DOE EAGLE-I** (Oak Ridge National Lab) — 2014-2022 county-level, 15-min
     resolution. The gold-standard academic dataset.
  2. **PREB filings** (energia.pr.gov) — LUMA's quarterly performance reports
     since 2021, parsed from PDFs.
  3. **Wayback Machine** captures of miluma.lumapr.com/outages — fills the
     gap between EAGLE-I (ends 2022) and our own archive (started 2026).
  4. **Our own R2 archive** of LUMA scrapes since project start.
  5. **LUMA daily BPS PDFs** — reserve / generation history features.
  6. **NWS observation archive** — weather features.
  7. **NHC HURDAT2** — storm features.

Usage:
    python -m scripts.train_outage_risk \
        --start 2018-01-01 --end 2026-04-30 \
        --output ./out/outage_risk-v1.joblib

The training script ships gated behind --i-have-enough-data; without that
flag it prints a manifest of how much data we'd have and exits. Prevents
shipping a paper-thin model that hasn't seen enough events.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)

MIN_OUTAGE_EVENTS = 200  # absolute minimum positive examples to attempt training
MIN_DAYS_OF_DATA = 180   # 6 months minimum


@dataclass
class TrainingManifest:
    days_of_data: int
    positive_events: int
    negative_hours: int
    ready: bool
    reasons: list[str]


def assemble_manifest(start: str, end: str) -> TrainingManifest:
    """Walk what we'd train against and return a readiness manifest.

    This intentionally does NOT touch the model. If you don't have enough
    data the right answer is "wait", not "ship a model anyway".

    Counts positive examples from three sources combined (outage_events from
    our scrape, EAGLE-I customer-out observations >= 1, Wayback parsed rows).
    """
    from ..src.pipeline.supabase_client import supabase

    sb = supabase()
    reasons: list[str] = []

    events = (
        sb.table("outage_events")
        .select("id", count="exact")
        .gte("started_at", start)
        .lt("started_at", end)
        .execute()
    )
    eagle = (
        sb.table("eagle_i_outages")
        .select("id", count="exact")
        .gte("ts", start)
        .lt("ts", end)
        .gt("customers_out", 0)
        .execute()
    )
    wayback = (
        sb.table("wayback_outage_history")
        .select("id", count="exact")
        .gte("snapshot_ts", start)
        .lt("snapshot_ts", end)
        .execute()
    )
    positive_events = (
        int(getattr(events, "count", 0) or 0)
        + int(getattr(eagle, "count", 0) or 0)
        + int(getattr(wayback, "count", 0) or 0)
    )
    if positive_events < MIN_OUTAGE_EVENTS:
        reasons.append(
            f"Only {positive_events} positive examples in window (need ≥ {MIN_OUTAGE_EVENTS})"
        )

    from datetime import date

    days = (date.fromisoformat(end) - date.fromisoformat(start)).days
    if days < MIN_DAYS_OF_DATA:
        reasons.append(f"Window is {days} days (need ≥ {MIN_DAYS_OF_DATA})")

    # Negative hours = total (78 munis × hours in window) minus positive hours.
    negative_hours = max(0, 78 * 24 * days - positive_events)

    return TrainingManifest(
        days_of_data=days,
        positive_events=positive_events,
        negative_hours=negative_hours,
        ready=not reasons,
        reasons=reasons,
    )


def train(manifest: TrainingManifest, output: Path) -> None:  # pragma: no cover
    """Benchmark LightGBM vs CatBoost, fit isotonic calibrator on the winner.

    Stub — wire up once data is ready. Importing here so the manifest path
    works without the ML extras installed.
    """
    try:
        from sklearn.isotonic import IsotonicRegression  # noqa: F401
        from sklearn.metrics import roc_auc_score  # noqa: F401
        import lightgbm  # noqa: F401
        import catboost  # noqa: F401
    except ImportError as exc:
        log.error(
            "Install with `pip install -e .[ml]` first (lightgbm + catboost + scikit-learn). %s",
            exc,
        )
        sys.exit(2)

    # Pipeline outline (intentionally not executed automatically):
    #   1. Pull a join across:
    #         outage_events + eagle_i_outages + wayback_outage_history
    #         (positive labels: any muni-hour with customers_out >= 1)
    #       × weather_snapshots (per-muni hourly weather features)
    #       × grid_snapshots (island reserves / generation)
    #       × hurricane_forecasts (cone-coverage features)
    #       × planned_work (active planned windows)
    #   2. Time-split: 60% train / 20% calibrate / 20% test, strictly
    #      temporal — random splits leak the future into training.
    #   3. Train BOTH:
    #         lgbm = LGBMClassifier(objective="binary",
    #             scale_pos_weight=neg/pos, n_estimators=500, max_depth=-1,
    #             learning_rate=0.05, min_data_in_leaf=20)
    #         cat = CatBoostClassifier(iterations=600, depth=6,
    #             learning_rate=0.05,
    #             auto_class_weights="Balanced",
    #             cat_features=<id columns>, verbose=False)
    #   4. Pick the booster with higher AUC on the validation fold.
    #   5. Fit IsotonicRegression on (winner.predict_proba(calibrate), y).
    #   6. Compute ECE + AUC + reliability curve on test fold.
    #   7. Persist a bundle to disk:
    #         {"booster": "lightgbm"|"catboost",
    #          "model": <fitted booster>,
    #          "calibrator": <IsotonicRegression>,
    #          "feature_schema": [...],
    #          "training_window": (start, end),
    #          "auc_test": float, "ece_test": float}
    #   8. Upload to R2 under models/outage_risk/<version>.joblib.
    #
    # We deliberately do not implement steps 1-8 yet — running a partial
    # version would produce a falsely confident model. The scaffold exists
    # so it's a small diff once data is ready.
    raise SystemExit(
        "Training body not yet wired. See docstring; expand stage-by-stage "
        "once enough data has accumulated."
    )


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Train the outage-risk XGBoost model")
    parser.add_argument("--start", required=True, help="ISO date YYYY-MM-DD")
    parser.add_argument("--end", required=True, help="ISO date YYYY-MM-DD (exclusive)")
    parser.add_argument(
        "--output",
        required=False,
        type=Path,
        help="Path to write the .joblib bundle (model + calibrator + metadata)",
    )
    parser.add_argument(
        "--i-have-enough-data",
        action="store_true",
        help="Required to actually train. Without this flag we print the manifest and exit.",
    )
    args = parser.parse_args()

    manifest = assemble_manifest(args.start, args.end)
    log.info("manifest: %s", manifest)
    if not manifest.ready:
        log.warning("not ready — refusing to train:\n  - %s", "\n  - ".join(manifest.reasons))
        return 1
    if not args.i_have_enough_data:
        log.info("manifest looks ready. Pass --i-have-enough-data to actually train.")
        return 0
    if not args.output:
        log.error("--output is required when training")
        return 2
    train(manifest, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
