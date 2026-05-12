# Outage-risk model — accuracy + honesty report

_Last updated: 2026-05-12_

## What's deployed today

The risk numbers you see at `/api/risk/municipalities` come from a **rule-based heuristic**, model version `heuristic-v2-20260512`. There is no trained ML model in production yet. Returning a "model probability" without a model behind it would be dishonest, so we don't.

## Inputs to the current heuristic

| Source | Field | Weight | Notes |
|---|---|---|---|
| NWS forecast | wind_kph, gust_kph, precip_mm, prob_precip | 0.50 | NWS API, public domain |
| NWS alerts | alert_level (advisory/watch/warning) | (additive) | Boost on top of weather |
| LUMA System Overview | grid status (normal / watch / strained / critical) | 0.30 | Scraped HTML |
| LUMA Planned Work | planned_work_active boolean per muni | 0.15 | Scraped HTML |
| (placeholder) | historical_outage_density | 0.05 | Returns 0 until backfill lands |
| NHC active advisories | forecast_cone_coverage_pct, nearest_storm_category | additive | Cat 3+ inside cone = +0.6 |

## How confidence intervals are computed

Until a real model ships, the `ci_low` / `ci_high` returned by the API are a **heuristic envelope**, not a statistical guarantee. We widen the band based on:

- Whether weather data is present (+10 absolute points if not)
- How stale the weather feature is (+5 if > 1h, +10 more if > 6h)
- A base width of 8 points around the score

The UI must label these as "uncertainty band" — never "95% confidence interval", because they aren't.

## When we'll ship a real model

We need:

- **At least 6 months** of `outage_events` rows alongside `weather_snapshots`, `grid_snapshots`, and (during storm season) `hurricane_forecasts`
- **At least 200 distinct outage events** in the window (positive class). With our 78 municipalities × 24 hours/day this gives ~14k muni-hours; 200 positives is enough to start.
- A clean **Wayback Machine** backfill of `miluma.lumapr.com/outages` snapshots covering the pre-archive period

The scaffold at `ingestion/scripts/train_outage_risk.py` enforces those gates: it refuses to train until the data is there.

## Planned model architecture

- **Algorithm**: XGBoost binary classifier (`objective="binary:logistic"`, `scale_pos_weight = neg/pos`, ~500 trees, depth 4)
- **Time split**: 12mo train / 3mo calibrate / 3mo test, strictly temporal — random splits leak the future into training
- **Calibration**: Isotonic regression fit on the calibrate fold's predicted probabilities vs actual labels
- **Output**: a single `.joblib` bundle holding the booster, the calibrator, the feature schema, and the training-window metadata; uploaded to R2 under `models/outage_risk/<version>.joblib`
- **Explainability**: SHAP values; top-3 features per prediction surfaced as `top_reasons`

## Honest accuracy expectations (once trained)

| Horizon | AUC range | Display label |
|---|---|---|
| 1-6h | 0.75-0.85 | "probability + uncertainty band" |
| 6-24h | 0.65-0.72 | "trend, not prediction" |
| > 24h | (not modeled) | "storm prior + forecast" only |

If after retraining we cannot beat the heuristic, we keep using the heuristic. Shipping a worse model with a fancier name is the kind of thing the no-synthetic-data rule was designed to prevent.

## How to verify the current heuristic

```sql
-- inside a muni page on a clear day:
select municipality_id, ts, risk_score, ci_low, ci_high, reasons, model_version
  from municipality_risk_latest
 where municipality_id = '72-127';

-- during a tropical-storm cone overlap:
-- risk_score should be at least 35; reasons[] mentions the storm_id
```

## Anti-features (what we will NOT do)

- Mock historical outage data to "train" the model
- Use random splits instead of temporal splits
- Report probabilities to two decimals without a calibration plot
- Hide the model version from the API
- Use a third-party scraper (LumaTrack) as if it were official data
