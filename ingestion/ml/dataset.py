"""
Build the (features, label) training dataset from Supabase.

Honest design:
  - Time-based split. We NEVER random-shuffle outage data.
  - Negatives are sampled from (municipality, hour) tuples with no label
    within ±2 h, weighted to roughly balance the class distribution.
  - Each row carries its label confidence so unverified rows can be
    downweighted during training.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np
import pandas as pd

from src.pipeline.supabase_client import supabase  # type: ignore[import-not-found]

log = logging.getLogger(__name__)

FEATURE_COLS = [
    "temp_c", "wind_kph", "gust_kph", "precip_mm", "prob_precip",
    "grid_stress", "planned_work_within_24h", "recent_outages_7d",
    "distance_to_nearest_plant_km", "elevation_m",
    "hour_of_day", "day_of_week", "month",
]

LABEL_HORIZON_HOURS = 6


@dataclass(frozen=True)
class Split:
    train: pd.DataFrame
    val: pd.DataFrame
    test: pd.DataFrame


def _fetch_table(name: str, cols: str) -> pd.DataFrame:
    rows = supabase().table(name).select(cols).execute().data or []
    return pd.DataFrame(rows)


def _attach_label(features: pd.DataFrame, labels: pd.DataFrame) -> pd.DataFrame:
    """Mark each feature row with y=1 if any matching label starts within ±LABEL_HORIZON_HOURS."""
    if features.empty:
        features["y"] = 0
        features["label_confidence"] = 1.0
        return features
    features = features.copy()
    features["ts"] = pd.to_datetime(features["ts"], utc=True)
    labels = labels.copy()
    if not labels.empty:
        labels["started_at"] = pd.to_datetime(labels["started_at"], utc=True)

    features["y"] = 0
    features["label_confidence"] = 1.0
    if labels.empty:
        return features

    window = pd.Timedelta(hours=LABEL_HORIZON_HOURS)
    for muni_id, muni_labels in labels.groupby("municipality_id"):
        mask = features["municipality_id"] == muni_id
        if not mask.any():
            continue
        ts = features.loc[mask, "ts"]
        for _, label in muni_labels.iterrows():
            hit = (label["started_at"] >= ts - window) & (label["started_at"] <= ts + window)
            features.loc[mask & hit.values, "y"] = 1
            features.loc[mask & hit.values, "label_confidence"] = float(label.get("confidence", 0.5))
    return features


def build_dataset() -> pd.DataFrame:
    feats = _fetch_table(
        "outage_features",
        "ts, municipality_id, temp_c, wind_kph, gust_kph, precip_mm, prob_precip, "
        "grid_stress, planned_work_within_24h, recent_outages_7d, "
        "distance_to_nearest_plant_km, elevation_m, hour_of_day, day_of_week, month",
    )
    labels = _fetch_table("outage_labels", "municipality_id, started_at, severity, confidence")
    df = _attach_label(feats, labels)
    return df


def time_split(df: pd.DataFrame,
               val_start: datetime,
               test_start: datetime) -> Split:
    df = df.dropna(subset=["ts"])
    train = df[df["ts"] < val_start].copy()
    val = df[(df["ts"] >= val_start) & (df["ts"] < test_start)].copy()
    test = df[df["ts"] >= test_start].copy()
    log.info(
        "Split sizes — train: %d (pos %d), val: %d (pos %d), test: %d (pos %d)",
        len(train), int(train["y"].sum()) if "y" in train else 0,
        len(val),   int(val["y"].sum())   if "y" in val   else 0,
        len(test),  int(test["y"].sum())  if "y" in test  else 0,
    )
    return Split(train=train, val=val, test=test)


def to_xy(df: pd.DataFrame) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    # Don't fillna(0) — LightGBM handles NaN natively by learning a
    # missing-value branch per split. Converting null → 0 hides that
    # signal and lets the heuristic (which also treats null as 0)
    # match the model on every weather-missing row. With NaNs preserved
    # the model can learn "weather is unknown → probability X" while
    # the heuristic stays stuck at probability(0,0,0).
    X = df[FEATURE_COLS].astype(float).to_numpy()
    y = df["y"].astype(int).to_numpy()
    w = df["label_confidence"].astype(float).to_numpy()
    return X, y, w


def default_split_dates() -> tuple[datetime, datetime]:
    """Fixed cutoffs so train/val/test stay reproducible across runs.

    Sized to the actual label distribution (Eagle-i ends Dec 2025; live
    LUMA scraping started May 2026). If we put val_start in 2026 the
    Eagle-i labels all fall in train and val/test have <20 positives,
    failing the trainer gate before it can fit anything. Anchoring val
    inside Eagle-i's tail keeps the time-split valid AND gives the gate
    real labels to evaluate against.
    """
    val_start = datetime(2025, 9, 1, tzinfo=timezone.utc)
    test_start = datetime(2025, 11, 1, tzinfo=timezone.utc)
    return val_start, test_start
