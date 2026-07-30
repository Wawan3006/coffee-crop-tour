# Coffee Crop Tour -- Analytics Pipeline

Implements Steps 12-17, 27-28 of the upgrade spec: Python validation, GPS
checking, production calculation, regional aggregation, crop-year
comparison, and Power BI reporting-table generation.

All scripts connect to the SAME database the backend API writes to (via
`DATABASE_URL`, see `../backend/.env.example`), so they can be run as a
scheduled job (cron / Task Scheduler / CI) independent of the API process.

## Files

| File | Step | Purpose |
|---|---|---|
| `db_connect.py` | - | Shared SQLAlchemy engine/session helper |
| `clean_data.py` | 12 | Batch data-quality classification (VALID/WARNING/REVIEW_REQUIRED/REJECTED) |
| `validate_gps.py` | 10 | Batch GPS validation (Indonesia bounding box, duplicate coordinates), reuses the exact same logic the sync API applies at upload time |
| `crop_estimation.py` | 13, 27 | Computes `model_estimate_kg` from farm area + expected yield, WITHOUT ever overwriting `farmer_estimate_kg` / `surveyor_estimate_kg` / `agronomist_adjusted_estimate_kg` |
| `regional_summary.py` | 14, 15 | Pandas-based aggregation by province/regency/crop-year + year-over-year comparison (Difference MT / %) |
| `export_powerbi.py` | 16, 17 | Builds the star-schema (`dim_*`/`fact_*`) tables AND creates `vw_powerbi_*` SQL views for a live Power BI connection |
| `run_pipeline.py` | 28 | Chains all of the above in order and logs the run to the `sync_log` table (run_id, start/end time, records processed/valid/warning/failed) |

## Running the full pipeline

```
python3 analytics/run_pipeline.py
```

This is the "scheduled Python processing" described in Step 28/29 --
schedule it (cron, Task Scheduler, or a CI job) to run before each Power BI
scheduled refresh window.

## Running an individual stage

Each script can also be run standalone, e.g. just re-validate GPS after a
bulk data correction:

```
python3 analytics/validate_gps.py
```

## Power BI connection (Step 16/17/29)

After running `export_powerbi.py` (directly or via `run_pipeline.py`), you
have two ways to connect Power BI:

1. **Live PostgreSQL connection (preferred for production):** Power BI's
   native PostgreSQL connector -> point it at the `vw_powerbi_*` views
   created in your database (NOT the raw `surveys`/`farms` tables). Set up
   a scheduled refresh in the Power BI service.
2. **CSV files (works everywhere, including local SQLite testing):**
   `analytics/powerbi_export/*.csv` -- star-schema `dim_date`,
   `dim_location`, `dim_farm`, `fact_surveys`, `fact_crop_estimates`,
   `fact_harvest_progress`, `fact_production`, `fact_data_quality`. Use
   Power BI's "Get Data > Text/CSV" or "Folder" connector.

## Verification performed

`tests/seed_and_run_pipeline.py` pushes 6 realistic surveys (across 2
provinces, 2 crop years, including one intentionally incomplete record)
through the ACTUAL FastAPI `/api/sync` endpoint, then runs every stage of
this pipeline against that real data and asserts concrete, non-trivial
outputs (22/22 checks passed): correct data-quality classification, GPS
flagging, non-zero model estimates, correct crop-year comparison math,
queryable SQL views, and valid star-schema CSV exports with numeric
columns Power BI can aggregate.
