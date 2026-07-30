# Coffee Crop Tour -- Indonesia Coffee Crop Survey & Intelligence Platform

An offline-first field data collection app for coffee crop surveys across
Indonesia, upgraded with a central database, Python backend/analytics, and
Power BI reporting, per the phased architecture below.

```
Mobile/Offline Web App -> Local Storage (IndexedDB) -> Sync API (FastAPI)
    -> Central Database (PostgreSQL/SQLite) -> Python Processing (analytics/)
    -> Power BI Dashboard
```

## Repository structure

```
coffee-crop-tour/
|
+-- coffee_crop_tour/        (the "frontend/" -- existing PWA, unchanged UX)
|   +-- index.html
|   +-- css/
|   +-- js/
|   |   +-- api.js           NEW: talks to the FastAPI backend when configured
|   |   +-- sync.js          UPDATED: real API sync + local-only fallback
|   |   +-- db.js            IndexedDB offline storage (unchanged)
|   |   +-- survey-form.js   75-field QN.xlsx-matching questionnaire wizard
|   |   +-- app.js           SPA router, dashboards, SYNC NOW button
|   |   +-- ... (auth.js, charts.js, map.js, utils.js, geo.js, data-seed.js)
|   +-- icons/
|   +-- tools/                gen_seed_data.py, smoke_test.js
|   +-- service-worker.js
|
+-- backend/                  NEW: Python FastAPI backend
|   +-- main.py               REST endpoints
|   +-- database.py           SQLAlchemy engine/session
|   +-- models.py             Central schema (users, farmers, farms, surveys, ...)
|   +-- schemas.py            Pydantic request/response models
|   +-- auth.py               Password hashing + JWT + role permissions
|   +-- sync.py               Idempotent upsert, GPS validation, data quality
|   +-- migrations/           Optional PostGIS setup SQL
|   +-- tests/                27 automated backend tests (all passing)
|   +-- requirements.txt
|   +-- .env.example          Copy to .env; NEVER commit the real .env
|   +-- README.md
|
+-- analytics/                 NEW: Python data processing pipeline
|   +-- db_connect.py
|   +-- clean_data.py         Data validation (Step 12)
|   +-- validate_gps.py       GPS validation (Step 10)
|   +-- crop_estimation.py    Production calculation, raw vs model (Step 13/27)
|   +-- regional_summary.py   Aggregation + crop-year comparison (Step 14/15)
|   +-- export_powerbi.py     Star-schema + SQL views for Power BI (Step 16/17)
|   +-- run_pipeline.py       Chains all of the above, logs to sync_log (Step 28)
|   +-- tests/                22 automated pipeline tests (all passing)
|   +-- README.md
|
+-- README.md                 (this file)
```

## What changed vs. the original app, and why nothing broke

The original Coffee Crop Tour PWA had **no backend at all** -- every survey
lived only in the browser's IndexedDB on the device that created it, and
"sync" was a `Math.random()`-based simulation. This upgrade adds a real
central database and API **without removing that local-only capability**:

- `coffee_crop_tour/js/api.js` is new. `Api.isConfigured()` returns `false`
  until an administrator explicitly sets a backend URL via the app's
  **More -> Configure Server URL** screen.
- `coffee_crop_tour/js/sync.js` checks `Api.isConfigured()` on every sync
  attempt: if `false`, it runs the exact same local-only simulation as
  before (zero behavior change for teams who haven't deployed a backend);
  if `true`, it POSTs real batches to `/api/sync`.
- Every other existing file (`survey-form.js`, `db.js`, `auth.js`,
  `map.js`, `charts.js`, `utils.js`, `data-seed.js`) is untouched except
  for the Home Dashboard's sync-status card, which was reworded to match
  the spec's exact language (Today's Surveys / Synced / Waiting to Sync /
  Sync Error / SYNC NOW button) and now shows real numbers.

This means: **the current GitHub Pages deployment keeps working today,
unchanged, for any team that hasn't stood up the backend yet.** Deploying
`backend/` and configuring one server URL upgrades the whole fleet to
central-database mode with zero re-installation on surveyors' phones.

## Getting started

### 1. Frontend (already deployed, no changes required)
See `coffee_crop_tour/` -- deploy via GitHub Pages or any static host, as
before. Works fully offline once loaded (service worker caches the app
shell; IndexedDB stores survey data).

### 2. Backend (new, optional until you're ready to centralize data)
See `backend/README.md` for full setup. Quick summary: copy
`backend/.env.example` to `backend/.env`, install the packages in
`backend/requirements.txt`, run `uvicorn main:app --reload --port 8000`.
Defaults to a local SQLite file with zero external setup; point
`DATABASE_URL` at a real PostgreSQL server for production.

### 3. Analytics pipeline (new)
See `analytics/README.md`. Run `python3 analytics/run_pipeline.py`
against the same `DATABASE_URL` the backend uses, on a schedule (cron /
Task Scheduler), to validate data, compute crop estimates, and refresh the
Power BI reporting tables/views.

### 4. Power BI
Connect Power BI's PostgreSQL connector to the `vw_powerbi_*` views (NOT
the raw operational tables), or use the CSV files written to
`analytics/powerbi_export/` for a quick start / local testing without a
live Postgres server. Set up a scheduled refresh in the Power BI service --
per-record real-time updates are not required (Step 29).

## Verification already performed in this workspace

| Suite | Result |
|---|---|
| `backend/tests/test_backend.py` | **27/27 PASSED** -- login, JWT auth, idempotent sync (same `survey_id` uploaded 3x = 1 row), GPS validation, role-based access control, estimate-adjustment permissions, regional aggregation |
| `analytics/tests/seed_and_run_pipeline.py` | **22/22 PASSED** -- real data pushed through the live API, then validated/estimated/aggregated/exported; confirms non-trivial computed outputs (correct MT totals, correct YoY difference %, queryable SQL views, valid star-schema CSVs) |
| `coffee_crop_tour/tools/smoke_test.js` | **13/13 PASSED** -- frontend calculation logic (aggregation, CSV/GeoJSON/KML export shape) |
| `node --check` on all 12 frontend JS files + service worker | **All pass**, zero syntax errors |

## Security notes (Step 30)

- `backend/.gitignore` excludes `.env`, `*.db`, and `photo_storage/` --
  never commit real database credentials, JWT secrets, or user data.
- Passwords are hashed server-side with PBKDF2-HMAC-SHA256 (200,000
  iterations, per-user random salt) -- never stored in plain text.
- The frontend's existing client-side "site password" gate
  (`CoffeeCrop2025`, visible in `index.html`) is a light deterrent only,
  NOT real access control -- real authentication now happens server-side
  via `/api/login` once a backend is configured. Treat the client-side
  gate as cosmetic and plan to remove it once every device is migrated to
  server-backed login.
- Rotate the demo backend passwords (`demo` for all 4 seeded accounts)
  before connecting any real device to a production backend.

## Implementation phases (status)

| Phase | Status |
|---|---|
| 1. Existing app kept working | Done -- zero breaking changes, verified via smoke test |
| 2. Offline database (IndexedDB) + sync status | Already existed; sync-status UI updated to match spec wording |
| 3. Central database (PostgreSQL/SQLite schema) | Done -- `backend/models.py`, 8+ tables with FKs, audit trail, soft delete |
| 4. Python API (FastAPI) | Done -- `backend/main.py`, all endpoints from Step 7 |
| 5. Synchronization (idempotent, duplicate-safe, retry) | Done -- `backend/sync.py`, verified with a 3x-reupload idempotency test |
| 6. Python analytics (validation, GPS, estimates, aggregation) | Done -- `analytics/`, verified end-to-end against real synced data |
| 7. Power BI (star schema + SQL views + CSV export) | Done -- `analytics/export_powerbi.py` |
| 8. Advanced features (PostGIS, photo storage, audit trail, conflict handling, crop-year comparison) | Done -- PostGIS migration script provided (Postgres-only), photo upload endpoint stores files not blobs, `audit_log` table + `_write_audit()` calls throughout, optimistic-lock conflict detection in `sync.py`, crop-year comparison in `regional_summary.py` |
