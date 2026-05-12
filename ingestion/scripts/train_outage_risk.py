"""
Offline trainer for the outage-risk model + isotonic calibration.

End-to-end pipeline:
  1. Pull labels from three sources (outage_events, eagle_i_outages, wayback)
     and emit one row per (municipality_id, hour) in the window.
  2. Join features: weather (NWS), grid stress (LUMA), planned-work, hurricane
     cone-overlap (NHC), historical outage density (EAGLE-I rollup).
  3. Strict temporal 60/20/20 split (train / calibrate / test). Never random.
  4. Train BOTH LightGBM and CatBoost with class-balanced weights.
  5. Pick the booster with higher AUC on the calibrate fold.
  6. Fit IsotonicRegression on the winner's calibrate predictions.
  7. Evaluate on the held-out test fold: AUC, ECE, Brier, reliability curve.
  8. Persist a .joblib bundle holding booster + calibrator + metadata.
  9. Optionally upload to R2 under models/outage_risk/<version>.joblib.

Honest constraints:
  * We REFUSE to train if the readiness manifest fails. Half-trained models
    produce false confidence.
  * Temporal split only. Random splits leak the future into training and
    inflate AUC by 5-10 points artificially.
  * Calibration metrics are reported. ECE > 5% means the probabilities are
    miscalibrated and we mark the bundle ``calibration_warning=True`` so the
    runtime can fall back to the heuristic.

Usage:
    # Quick readiness check (no training):
    python -m scripts.train_outage_risk --start 2018-01-01 --end 2026-04-30

    # Actually train (requires the gate to pass):
    python -m scripts.train_outage_risk \\
        --start 2018-01-01 --end 2026-04-30 \\
        --output ./out/outage_risk-v1.joblib \\
        --i-have-enough-data \\
        --upload-r2
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from dataclasses import dataclass, field, asdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

MIN_OUTAGE_EVENTS = 200
MIN_DAYS_OF_DATA = 180
LABEL_HORIZON_HOURS = 6
# Feature columns the trainer expects. Order matters for the persisted schema.
FEATURE_COLS = (
    "wind_kph",
    "gust_kph",
    "precip_mm",
    "prob_precip",
    "alert_level_num",
    "grid_status_num",
    "planned_active",
    "hurricane_cone",
    "hurricane_category",
    "historical_outage_density",
    "month",
    "hour",
    "dow",
)
CAT_FEATURES = ("alert_level_num", "grid_status_num", "month", "hour", "dow")


@dataclass
class TrainingManifest:
    days_of_data: int
    positive_events: int
    negative_hours: int
    ready: bool
    reasons: list[str]


@dataclass
class TrainingResult:
    booster: str
    auc_train: float
    auc_calibrate: float
    auc_test: float
    ece_test: float
    brier_test: float
    n_train: int
    n_calibrate: int
    n_test: int
    positive_rate: float
    feature_schema: list[str]
    cat_features: list[str]
    training_window: tuple[str, str]
    calibration_warning: bool
    reliability_table: list[dict[str, float]] = field(default_factory=list)


# ---------------------------------------------------------------------------
# 1. Readiness manifest
# ---------------------------------------------------------------------------


def assemble_manifest(start: str, end: str) -> TrainingManifest:
    from src.pipeline.supabase_client import supabase

    sb = supabase()
    reasons: list[str] = []

    def _count(table: str, ts_col: str, filters: dict[str, Any] | None = None) -> int:
        q = sb.table(table).select("id", count="exact").gte(ts_col, start).lt(ts_col, end)
        if filters:
            for k, v in filters.items():
                q = q.gt(k, v) if k.startswith("gt:") else q.eq(k, v)
        return int(getattr(q.execute(), "count", 0) or 0)

    pos_outage_events = _count("outage_events", "started_at")
    pos_eagle = _count("eagle_i_outages", "ts", filters={"gt:customers_out": 0})
    pos_wayback = _count("wayback_outage_history", "snapshot_ts")
    positive_events = pos_outage_events + pos_eagle + pos_wayback
    if positive_events < MIN_OUTAGE_EVENTS:
        reasons.append(
            f"Only {positive_events} positive examples in window "
            f"(outage_events={pos_outage_events}, eagle_i={pos_eagle}, "
            f"wayback={pos_wayback}). Need ≥ {MIN_OUTAGE_EVENTS}."
        )

    days = (date.fromisoformat(end) - date.fromisoformat(start)).days
    if days < MIN_DAYS_OF_DATA:
        reasons.append(f"Window is {days} days (need ≥ {MIN_DAYS_OF_DATA})")

    return TrainingManifest(
        days_of_data=days,
        positive_events=positive_events,
        negative_hours=max(0, 78 * 24 * days - positive_events),
        ready=not reasons,
        reasons=reasons,
    )


# ---------------------------------------------------------------------------
# 2. Dataset assembly
# ---------------------------------------------------------------------------


_ALERT_NUM = {"none": 0, "advisory": 1, "watch": 2, "warning": 3}
_STATUS_NUM = {"normal": 0, "watch": 1, "strained": 2, "critical": 3, "stale": 1, "unknown": 1}


def _hour_floor(iso: str) -> datetime:
    dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return dt.replace(minute=0, second=0, microsecond=0, tzinfo=timezone.utc)


def assemble_dataset(start: str, end: str):
    """Return (X DataFrame, y ndarray, ts Series) sorted by ts.

    Imported lazily so the manifest path works without pandas installed.
    """
    import pandas as pd
    from src.pipeline.supabase_client import supabase

    sb = supabase()

    # ----- positive labels: union of three sources, bucketed to the hour
    log.info("Fetching positive-label sources…")
    pos_oe = (
        sb.table("outage_events")
        .select("municipality_id, started_at")
        .gte("started_at", start)
        .lt("started_at", end)
        .not_.is_("municipality_id", "null")
        .execute()
        .data
    ) or []
    pos_eagle = (
        sb.table("eagle_i_outages")
        .select("municipality_id, ts")
        .gte("ts", start)
        .lt("ts", end)
        .gt("customers_out", 0)
        .not_.is_("municipality_id", "null")
        .execute()
        .data
    ) or []
    pos_set: set[tuple[str, str]] = set()
    for r in pos_oe:
        pos_set.add((r["municipality_id"], _hour_floor(r["started_at"]).isoformat()))
    for r in pos_eagle:
        pos_set.add((r["municipality_id"], _hour_floor(r["ts"]).isoformat()))
    # Wayback: rows are JSONB with region names, no muni id. We accept the
    # imprecision and tag the WHOLE island as positive for that hour. This
    # over-labels neighboring munis during major events — call it a "training
    # signal", and the model can still learn to differentiate via features.
    pos_wayback = (
        sb.table("wayback_outage_history")
        .select("snapshot_ts, regions")
        .gte("snapshot_ts", start)
        .lt("snapshot_ts", end)
        .execute()
        .data
    ) or []
    munis = [
        r["id"]
        for r in (
            sb.table("municipalities").select("id, centroid_lon, centroid_lat").execute().data
            or []
        )
    ]
    for r in pos_wayback:
        regions = r.get("regions") or []
        # Skip rows where no region had any affected customers
        any_affected = any(
            (reg.get("customers_affected") or 0) > 0 for reg in regions if isinstance(reg, dict)
        )
        if not any_affected:
            continue
        hour = _hour_floor(r["snapshot_ts"]).isoformat()
        for muni in munis:
            pos_set.add((muni, hour))
    log.info("Positive hour-muni cells: %d", len(pos_set))

    # ----- feature: weather (per-muni, hourly resample with forward-fill)
    log.info("Fetching weather features…")
    weather_rows = (
        sb.table("weather_snapshots")
        .select("ts, municipality_id, wind_kph, gust_kph, precip_mm, prob_precip, alert_level")
        .gte("ts", start)
        .lt("ts", end)
        .execute()
        .data
    ) or []
    wx = pd.DataFrame(weather_rows)
    if not wx.empty:
        wx["ts"] = pd.to_datetime(wx["ts"], utc=True).dt.floor("h")
        wx["alert_level_num"] = wx["alert_level"].map(_ALERT_NUM).fillna(0).astype(int)
        wx = (
            wx.sort_values("ts")
            .groupby(["municipality_id", "ts"], as_index=False)
            .last()
        )

    # ----- feature: grid status (island-wide, hourly)
    log.info("Fetching grid snapshots…")
    grid_rows = (
        sb.table("grid_snapshots")
        .select("ts, status")
        .gte("ts", start)
        .lt("ts", end)
        .execute()
        .data
    ) or []
    grid = pd.DataFrame(grid_rows)
    if not grid.empty:
        grid["ts"] = pd.to_datetime(grid["ts"], utc=True).dt.floor("h")
        grid["grid_status_num"] = grid["status"].map(_STATUS_NUM).fillna(1).astype(int)
        grid = grid.sort_values("ts").groupby("ts", as_index=False).last()

    # ----- feature: planned work (per-muni active windows)
    log.info("Fetching planned work…")
    plan_rows = (
        sb.table("planned_work")
        .select("municipality_id, start_ts, end_ts")
        .gte("end_ts", start)
        .lt("start_ts", end)
        .not_.is_("municipality_id", "null")
        .execute()
        .data
    ) or []
    planned_set: set[tuple[str, str]] = set()
    for p in plan_rows:
        try:
            t0 = _hour_floor(p["start_ts"])
            t1 = _hour_floor(p["end_ts"])
        except (KeyError, TypeError):
            continue
        cur = t0
        while cur <= t1:
            planned_set.add((p["municipality_id"], cur.isoformat()))
            cur += timedelta(hours=1)

    # ----- feature: hurricane cones (binary in/out + max category)
    log.info("Fetching hurricane forecasts…")
    cones_rows = (
        sb.table("hurricane_forecasts")
        .select("storm_id, category, cone_geojson, forecast_made_at")
        .gte("forecast_made_at", start)
        .lt("forecast_made_at", end)
        .execute()
        .data
    ) or []
    # Pre-compute centroid containment per (forecast_made_at_hour, muni).
    muni_centroids = {
        r["id"]: (float(r["centroid_lon"]), float(r["centroid_lat"]))
        for r in (
            sb.table("municipalities")
            .select("id, centroid_lon, centroid_lat")
            .not_.is_("centroid_lon", "null")
            .execute()
            .data
            or []
        )
    }

    def point_in_polygon(lon: float, lat: float, ring: list[list[float]]) -> bool:
        inside = False
        n = len(ring)
        j = n - 1
        for i in range(n):
            xi, yi = ring[i][0], ring[i][1]
            xj, yj = ring[j][0], ring[j][1]
            if ((yi > lat) != (yj > lat)) and (
                lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi
            ):
                inside = not inside
            j = i
        return inside

    hurricane_per_hour: dict[tuple[str, str], tuple[float, int]] = {}
    for storm in cones_rows:
        cone = storm.get("cone_geojson") or {}
        if cone.get("type") != "Polygon":
            continue
        rings = cone.get("coordinates") or []
        if not rings:
            continue
        outer = rings[0]
        hour_iso = _hour_floor(storm["forecast_made_at"]).isoformat()
        cat = int(storm.get("category") or 0)
        for muni, (lon, lat) in muni_centroids.items():
            if point_in_polygon(lon, lat, outer):
                prior = hurricane_per_hour.get((muni, hour_iso), (0.0, -2))
                hurricane_per_hour[(muni, hour_iso)] = (100.0, max(prior[1], cat))

    # ----- feature: historical outage density (rolling 30d EAGLE-I customer-hours)
    #
    # CRITICAL: the rolling window must be strictly PRIOR to the label hour. If
    # we include the current hour, customers_out at ts is the source of the y
    # label at ts → temporal leak → inflated AUC. We fetch 30d of history
    # *before* `start` plus the in-window history, then compute a strictly-prior
    # rolling sum (shift by one hour). The lookup at the same (muni, ts) below
    # therefore returns the sum over [ts - 30d, ts).
    log.info("Computing historical outage density (strictly prior 30d window)…")
    hist_rows = (
        sb.table("eagle_i_outages")
        .select("municipality_id, ts, customers_out")
        .gte("ts", (date.fromisoformat(start) - timedelta(days=30)).isoformat())
        .lt("ts", end)
        .gt("customers_out", 0)
        .not_.is_("municipality_id", "null")
        .execute()
        .data
    ) or []
    hist_df = pd.DataFrame(hist_rows)
    if not hist_df.empty:
        hist_df["ts"] = pd.to_datetime(hist_df["ts"], utc=True).dt.floor("h")
        # Sum simultaneous reports for the same (muni, ts) before rolling.
        hist_df = hist_df.groupby(
            ["municipality_id", "ts"], as_index=False
        )["customers_out"].sum()
        # Build a continuous hourly index per muni so the rolling-30d window
        # is consistent. Resample fills gaps with 0, shift(1) makes it strictly
        # prior, then we re-stack to (muni, ts) → density.
        pieces = []
        for muni_id, sub in hist_df.groupby("municipality_id"):
            sub = (
                sub.set_index("ts")["customers_out"]
                .resample("h").sum()
                .fillna(0.0)
                .shift(1)               # strictly prior — no current-hour leak
                .rolling("30D").sum()
                .fillna(0.0)
                .rename("density")
                .reset_index()
            )
            sub["municipality_id"] = muni_id
            pieces.append(sub)
        hist_df = pd.concat(pieces, ignore_index=True) if pieces else pd.DataFrame(
            columns=["municipality_id", "ts", "density"]
        )
    # If we computed nothing, all density is 0.

    # ----- build the row grid
    log.info("Building muni-hour grid…")
    all_hours = pd.date_range(
        start=pd.Timestamp(start, tz="UTC"),
        end=pd.Timestamp(end, tz="UTC"),
        freq="h",
        inclusive="left",
    )
    rows: list[dict[str, Any]] = []
    # Index wx by (muni, ts) for fast lookup
    wx_idx = (
        wx.set_index(["municipality_id", "ts"]) if not wx.empty else None
    )
    grid_idx = grid.set_index("ts") if not grid.empty else None
    # Density lookup — values are the rolling 30d sum strictly prior to ts.
    hist_lookup: dict[tuple[str, pd.Timestamp], float] = {}
    if not hist_df.empty:
        for _, r in hist_df.iterrows():
            hist_lookup[(r["municipality_id"], r["ts"])] = float(r["density"])

    for muni in muni_centroids.keys():
        for ts in all_hours:
            ts_iso = ts.isoformat()
            wx_row = (
                wx_idx.loc[(muni, ts)].to_dict()
                if wx_idx is not None and (muni, ts) in wx_idx.index
                else {}
            )
            grid_row = (
                grid_idx.loc[ts].to_dict()
                if grid_idx is not None and ts in grid_idx.index
                else {}
            )
            cone, cat = hurricane_per_hour.get((muni, ts_iso), (0.0, -2))
            rolling = hist_lookup.get((muni, ts), 0.0)
            rows.append(
                {
                    "ts": ts,
                    "municipality_id": muni,
                    "wind_kph": wx_row.get("wind_kph"),
                    "gust_kph": wx_row.get("gust_kph"),
                    "precip_mm": wx_row.get("precip_mm"),
                    "prob_precip": wx_row.get("prob_precip"),
                    "alert_level_num": wx_row.get("alert_level_num", 0),
                    "grid_status_num": grid_row.get("grid_status_num", 1),
                    "planned_active": int((muni, ts_iso) in planned_set),
                    "hurricane_cone": cone,
                    "hurricane_category": cat,
                    "historical_outage_density": rolling,
                    "month": ts.month,
                    "hour": ts.hour,
                    "dow": ts.dayofweek,
                    "y": int((muni, ts_iso) in pos_set),
                }
            )
    df = pd.DataFrame(rows).sort_values("ts").reset_index(drop=True)
    log.info(
        "Dataset: %d rows, %d positives (%.3f%% rate)",
        len(df),
        int(df["y"].sum()),
        100.0 * df["y"].mean() if len(df) else 0.0,
    )
    return df


# ---------------------------------------------------------------------------
# 3. Calibration metrics
# ---------------------------------------------------------------------------


def expected_calibration_error(y_true, y_prob, n_bins: int = 15) -> tuple[float, list[dict[str, float]]]:
    """Reliability-table + ECE. Equal-width bins."""
    import numpy as np

    y_true = np.asarray(y_true)
    y_prob = np.asarray(y_prob)
    bins = np.linspace(0, 1, n_bins + 1)
    indices = np.digitize(y_prob, bins) - 1
    table: list[dict[str, float]] = []
    ece = 0.0
    total = len(y_true)
    for b in range(n_bins):
        mask = indices == b
        n = int(mask.sum())
        if n == 0:
            continue
        avg_pred = float(y_prob[mask].mean())
        avg_true = float(y_true[mask].mean())
        table.append({"bin": b, "n": n, "avg_pred": avg_pred, "avg_true": avg_true})
        ece += (n / total) * abs(avg_pred - avg_true)
    return float(ece), table


# ---------------------------------------------------------------------------
# 4. Train + benchmark
# ---------------------------------------------------------------------------


def train(
    manifest: TrainingManifest,
    df,
    start: str,
    end: str,
    output: Path,
    upload_r2: bool = False,
) -> TrainingResult:
    import numpy as np
    import pandas as pd
    from sklearn.isotonic import IsotonicRegression
    from sklearn.metrics import roc_auc_score, brier_score_loss
    import lightgbm as lgb
    import catboost as cb
    import joblib

    feature_cols = list(FEATURE_COLS)
    cat_cols = list(CAT_FEATURES)

    # Strict temporal split.
    n = len(df)
    train_end = int(n * 0.6)
    cal_end = int(n * 0.8)
    X_train, y_train = df.iloc[:train_end][feature_cols], df.iloc[:train_end]["y"]
    X_cal, y_cal = df.iloc[train_end:cal_end][feature_cols], df.iloc[train_end:cal_end]["y"]
    X_test, y_test = df.iloc[cal_end:][feature_cols], df.iloc[cal_end:]["y"]
    log.info("Split sizes: train=%d calibrate=%d test=%d", len(X_train), len(X_cal), len(X_test))

    pos = int(y_train.sum())
    neg = len(y_train) - pos
    scale_pos_weight = max(1.0, neg / max(1, pos))
    log.info("Class balance: pos=%d neg=%d -> scale_pos_weight=%.1f", pos, neg, scale_pos_weight)

    # --- LightGBM
    lgb_model = lgb.LGBMClassifier(
        objective="binary",
        n_estimators=500,
        learning_rate=0.05,
        max_depth=-1,
        num_leaves=63,
        min_data_in_leaf=20,
        scale_pos_weight=scale_pos_weight,
        random_state=42,
        verbose=-1,
    )
    lgb_model.fit(
        X_train,
        y_train,
        eval_set=[(X_cal, y_cal)],
        callbacks=[lgb.early_stopping(30, verbose=False)],
    )
    lgb_train_auc = roc_auc_score(y_train, lgb_model.predict_proba(X_train)[:, 1])
    lgb_cal_pred = lgb_model.predict_proba(X_cal)[:, 1]
    lgb_cal_auc = roc_auc_score(y_cal, lgb_cal_pred)
    log.info("LightGBM: AUC train=%.4f calibrate=%.4f", lgb_train_auc, lgb_cal_auc)

    # --- CatBoost
    cb_model = cb.CatBoostClassifier(
        iterations=600,
        depth=6,
        learning_rate=0.05,
        loss_function="Logloss",
        auto_class_weights="Balanced",
        cat_features=cat_cols,
        random_seed=42,
        verbose=False,
    )
    # CatBoost requires categorical columns to be int or str
    X_train_cb = X_train.copy()
    X_cal_cb = X_cal.copy()
    X_test_cb = X_test.copy()
    for c in cat_cols:
        X_train_cb[c] = X_train_cb[c].astype(int)
        X_cal_cb[c] = X_cal_cb[c].astype(int)
        X_test_cb[c] = X_test_cb[c].astype(int)
    cb_model.fit(X_train_cb, y_train, eval_set=(X_cal_cb, y_cal), early_stopping_rounds=30)
    cb_train_auc = roc_auc_score(y_train, cb_model.predict_proba(X_train_cb)[:, 1])
    cb_cal_pred = cb_model.predict_proba(X_cal_cb)[:, 1]
    cb_cal_auc = roc_auc_score(y_cal, cb_cal_pred)
    log.info("CatBoost: AUC train=%.4f calibrate=%.4f", cb_train_auc, cb_cal_auc)

    # --- Pick winner on calibrate AUC
    if lgb_cal_auc >= cb_cal_auc:
        booster_name = "lightgbm"
        booster = lgb_model
        cal_pred = lgb_cal_pred
        train_auc = lgb_train_auc
        cal_auc = lgb_cal_auc
        X_test_used = X_test
    else:
        booster_name = "catboost"
        booster = cb_model
        cal_pred = cb_cal_pred
        train_auc = cb_train_auc
        cal_auc = cb_cal_auc
        X_test_used = X_test_cb
    log.info("Winner on calibrate: %s (AUC=%.4f)", booster_name, cal_auc)

    # --- Isotonic calibration on the winner
    iso = IsotonicRegression(out_of_bounds="clip")
    iso.fit(cal_pred, y_cal)

    # --- Test-fold evaluation
    test_raw = booster.predict_proba(X_test_used)[:, 1]
    test_cal = iso.transform(test_raw)
    test_auc = roc_auc_score(y_test, test_cal)
    test_brier = brier_score_loss(y_test, test_cal)
    test_ece, reliability_table = expected_calibration_error(y_test, test_cal)
    log.info(
        "Test fold: AUC=%.4f Brier=%.4f ECE=%.4f", test_auc, test_brier, test_ece
    )

    calibration_warning = test_ece > 0.05

    result = TrainingResult(
        booster=booster_name,
        auc_train=float(train_auc),
        auc_calibrate=float(cal_auc),
        auc_test=float(test_auc),
        ece_test=float(test_ece),
        brier_test=float(test_brier),
        n_train=len(X_train),
        n_calibrate=len(X_cal),
        n_test=len(X_test),
        positive_rate=float(df["y"].mean()),
        feature_schema=feature_cols,
        cat_features=cat_cols,
        training_window=(start, end),
        calibration_warning=calibration_warning,
        reliability_table=reliability_table,
    )

    # --- Persist
    output.parent.mkdir(parents=True, exist_ok=True)
    bundle = {
        "model": booster,
        "calibrator": iso,
        "metadata": asdict(result),
        "manifest": asdict(manifest),
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }
    joblib.dump(bundle, output)
    log.info("Wrote bundle: %s", output)

    # Sidecar JSON for grep-ability.
    sidecar = output.with_suffix(".json")
    sidecar.write_text(json.dumps(bundle["metadata"] | {"trained_at": bundle["trained_at"]}, indent=2))
    log.info("Wrote metadata sidecar: %s", sidecar)

    if upload_r2:
        _upload_to_r2(output, sidecar)

    return result


def _upload_to_r2(bundle_path: Path, sidecar_path: Path) -> None:
    try:
        import boto3
        from botocore.client import Config
    except ImportError:
        log.warning("boto3 not installed; skipping R2 upload")
        return
    bucket = os.environ.get("R2_BUCKET", "islagrid-raw")
    endpoint = os.environ.get("R2_ENDPOINT")
    if not endpoint:
        log.warning("R2_ENDPOINT not set; skipping R2 upload")
        return
    s3 = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )
    for path, ct in (
        (bundle_path, "application/octet-stream"),
        (sidecar_path, "application/json"),
    ):
        key = f"models/outage_risk/{path.name}"
        with open(path, "rb") as f:
            s3.put_object(Bucket=bucket, Key=key, Body=f.read(), ContentType=ct)
        log.info("Uploaded to R2: s3://%s/%s", bucket, key)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    p = argparse.ArgumentParser(description="Train the outage-risk model")
    p.add_argument("--start", required=True, help="ISO date YYYY-MM-DD")
    p.add_argument("--end", required=True, help="ISO date YYYY-MM-DD (exclusive)")
    p.add_argument("--output", type=Path, help="Path to write the .joblib bundle")
    p.add_argument(
        "--i-have-enough-data",
        action="store_true",
        help="Required to actually train. Without it, prints the manifest and exits.",
    )
    p.add_argument(
        "--upload-r2",
        action="store_true",
        help="Upload the bundle + sidecar to R2 under models/outage_risk/.",
    )
    args = p.parse_args()

    try:
        manifest = assemble_manifest(args.start, args.end)
    except KeyError as exc:
        log.error(
            "Missing required env var %s. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.",
            exc,
        )
        return 2
    except Exception as exc:  # noqa: BLE001
        log.error("Manifest assembly failed: %s", exc)
        return 2

    log.info("Manifest: %s", manifest)
    if not manifest.ready:
        log.warning("Not ready — refusing to train:\n  - %s", "\n  - ".join(manifest.reasons))
        return 1
    if not args.i_have_enough_data:
        log.info("Manifest looks ready. Pass --i-have-enough-data to actually train.")
        return 0
    if not args.output:
        log.error("--output is required when training")
        return 2

    log.info("Assembling dataset…")
    df = assemble_dataset(args.start, args.end)
    if len(df) == 0:
        log.error("Empty dataset — feature joins produced no rows.")
        return 3
    result = train(manifest, df, args.start, args.end, args.output, upload_r2=args.upload_r2)
    log.info("Training complete: %s", asdict(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
