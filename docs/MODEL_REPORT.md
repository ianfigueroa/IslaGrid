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

- **At least 6 months** of label history (positive examples come from `outage_events` + `eagle_i_outages` + `wayback_outage_history` combined)
- **At least 200 distinct positive examples** in the window
- Weather + grid feature coverage over the same window

The scaffold at `ingestion/scripts/train_outage_risk.py` enforces those gates: it refuses to train until the data is there.

## Training-data sources (all official, all public)

| Source | Coverage | Resolution | Why we use it |
|---|---|---|---|
| **DOE EAGLE-I** (ORNL) | 2014-2022 | 15-min, US county-level | The academic standard; PR is included as state FIPS 72 |
| **PREB filings** (energia.pr.gov) | 2021-present | Quarterly | Mandatory regulatory reports including SAIDI/SAIFI + event lists |
| **Wayback Machine** snapshots | 2022-present | Whenever IA crawled the page | Fills the gap between EAGLE-I and our own archive |
| Our own LUMA scrape (R2-archived) | 2026-present | 15-min cadence | Highest resolution + freshness |
| **LUMA BPS PDFs** | 2021-present | Daily | Reserve/generation features |
| **NWS observation archive** | rolling | Hourly | Weather features |
| **NHC HURDAT2** | 1851-present | 6h advisories | Storm features |

Three of these (EAGLE-I, PREB, Wayback) were added in Block 6 specifically because LUMA does not publish a historical outage dataset directly.

## Planned model architecture

- **Boosters** (we benchmark both): **LightGBM** primary + **CatBoost** challenger on the same temporal split; whichever wins on the validation fold gets shipped. LightGBM is the standard in current power-outage prediction papers; CatBoost often edges it on tabular data with many categorical features (muni id, alert level, fuel type). XGBoost is fine but slightly behind both on this class of problem.
- **Time split**: 60% train / 20% calibrate / 20% test, strictly temporal — random splits leak the future into training.
- **Calibration**: Isotonic regression fit on the calibrate fold's predicted probabilities vs actual labels.
- **Output**: a single `.joblib` bundle: `{booster: "lightgbm"|"catboost", model, calibrator, feature_schema, training_window, auc_test, ece_test}`. Uploaded to R2 under `models/outage_risk/<version>.joblib`.
- **Explainability**: SHAP values; top-3 features per prediction surfaced as `top_reasons`.

### Why not deep learning?

We considered (and rejected for now):

- **LSTM / Transformer on raw sequences**: tabular gradient-boosted trees beat them on power-outage benchmarks with the data sizes we'll have. Comes back on the table once we have years of high-frequency feeder-level data we don't have today.
- **TabPFN** (foundation model for small tabular data): useful while data is small, but it caps at ~10k rows and needs a GPU at inference. The EAGLE-I backfill alone is millions of rows, so we're not in TabPFN's sweet spot.
- **Spatiotemporal GNN**: would beat boosters by ~5-8% AUC if we had feeder-level grid topology, but that data is non-public.

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
