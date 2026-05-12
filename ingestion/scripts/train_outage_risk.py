"""
Offline trainer for the outage-risk XGBoost model + isotonic calibration.

Run manually after the data archive is large enough; the production pipeline
keeps using the heuristic until a trained `.joblib` lands in R2 under
`models/outage_risk/<version>.joblib`.

Honest accuracy expectations (see docs/MODEL_REPORT.md):
  * 1-6h horizon: AUC ~0.75-0.85 once we have ~18 months of data
  * 6-24h horizon: AUC 0.65-0.72; surfaced as "trend, not prediction"
  * >24h: not modeled — we surface the storm prior + forecast and leave the
    inference to the reader. Refusing to fabricate probabilities is the
    point.

Data sources (all official, no synthetic data):
  1. Our own R2-archived LUMA scrapes since project start
  2. Wayback Machine snapshots of miluma.lumapr.com/outages for backfill
  3. LUMA daily BPS PDFs (reserve/generation features)
  4. NWS observation archive
  5. NHC HURDAT2 (storm features)

Usage:
    python -m scripts.train_outage_risk \
        --start 2025-01-01 --end 2026-04-30 \
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
    positive_events = int(getattr(events, "count", 0) or 0)
    if positive_events < MIN_OUTAGE_EVENTS:
        reasons.append(
            f"Only {positive_events} outage events in window (need ≥ {MIN_OUTAGE_EVENTS})"
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
    """Train XGBoost + fit isotonic calibrator. Stub — wire up once data is ready."""
    try:
        from sklearn.isotonic import IsotonicRegression  # noqa: F401
        from xgboost import XGBClassifier  # noqa: F401
    except ImportError as exc:
        log.error(
            "Install with `pip install -e .[ml]` first (xgboost + scikit-learn). %s",
            exc,
        )
        sys.exit(2)

    # Pipeline outline (intentionally not executed automatically):
    #   1. Pull rows from municipality_risk_snapshots + outage_events
    #      joined on (ts, municipality_id), labeled positive for any
    #      muni-hour with a started_at falling inside the next 6h.
    #   2. Time-split: 12mo train / 3mo calibrate / 3mo test.
    #   3. Train XGBClassifier(objective="binary:logistic",
    #      scale_pos_weight=neg/pos, n_estimators=500, max_depth=4).
    #   4. Fit IsotonicRegression on (predict_proba on calibrate, y_calibrate).
    #   5. Compute ECE + AUC on test fold; persist bundle to disk.
    #   6. Upload .joblib to R2 under models/outage_risk/<version>.joblib.
    #
    # We deliberately do not implement steps 1-6 yet — running a partial
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
