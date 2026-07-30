# Coffee Crop Tour -- Backend API

FastAPI backend implementing Steps 4-13, 23-28 of the upgrade spec:
central PostgreSQL database, REST sync API, server-side auth, GPS/data
validation, and crop-estimate calculation support.

## Quick start (local development, zero external setup)

1. `cd backend`
2. Copy `.env.example` to `.env` and set `JWT_SECRET_KEY` at minimum.
3. Create a virtual environment and activate it.
4. Install the packages listed in `requirements.txt` into that environment
   using your normal Python package manager.
5. Start the server: `uvicorn main:app --reload --port 8000`

With no `DATABASE_URL` set, this runs against a local SQLite file
(`coffee_crop_tour_dev.db`) -- no PostgreSQL server needed to try it out.
Interactive API docs: http://localhost:8000/docs

On first startup, 4 demo accounts are seeded automatically (same
credentials as the existing frontend's local-only demo mode):

| username | password | role |
|---|---|---|
| surveyor1 | demo | Field Surveyor |
| agronomist1 | demo | Agronomist |
| manager1 | demo | Manager |
| admin1 | demo | Administrator |

Change these passwords (or disable the accounts) before any real
deployment. They exist only to make local testing effortless.

## Running against real PostgreSQL (production, Step 4)

1. Provision a managed PostgreSQL instance (Railway, Render, Supabase,
   Azure Database for PostgreSQL, AWS RDS, or a company-managed server).
2. Set `DATABASE_URL` in `.env`:
   ```
   DATABASE_URL=postgresql+psycopg2://user:password@host:5432/coffee_crop_tour
   ```
3. Optional (Step 11): enable PostGIS for spatial queries by running the
   SQL script in `migrations/001_postgis_setup.sql` against that database
   using your normal PostgreSQL client tool.
4. Start the API the same way (`uvicorn main:app`). Tables are created
   automatically on first startup via `init_db()`. For production schema
   changes after go-live, introduce a proper migration tool (e.g. Alembic)
   instead of relying on `create_all()`.

## Testing (already run and passing -- see workspace verification notes)

Run: `python3 tests/test_backend.py`

27/27 checks pass, covering: login, JWT auth enforcement, idempotent batch
sync (uploading the same `survey_id` 3 times creates exactly one row), GPS
validation (out-of-Indonesia detection, duplicate-coordinate detection),
role-based permission enforcement (Field Surveyor cannot manage users or
adjust estimates; only Agronomist/Administrator can), and regional
aggregation via `/api/regions`.

## Connecting the existing frontend

The existing Coffee Crop Tour PWA (in `../coffee_crop_tour/`) works
completely standalone with no backend, exactly as before -- this is the
default. To point it at this backend instead:

1. Open the app -> More menu (only visible to Administrator role) ->
   Configure Server URL -> enter your deployed FastAPI base URL
   (e.g. `https://api.yourcompany.com`).
2. The app will now POST batches to `/api/sync` when the surveyor taps
   SYNC NOW or comes back online, instead of the local-only simulation.
3. To disable and go back to local-only mode, leave the URL blank.

This is implemented in `../coffee_crop_tour/js/api.js` and
`../coffee_crop_tour/js/sync.js` -- `Api.isConfigured()` gates every call,
so the original GitHub Pages deployment is never broken for teams who
haven't set up a backend yet.

## Environment variables (never commit real secrets -- see .env.example)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL (prod) or SQLite (dev) connection string |
| `JWT_SECRET_KEY` | Signs auth tokens -- generate a random 64-char hex string |
| `JWT_EXPIRE_MINUTES` | Token lifetime (default 480 = 8 hours, one field day) |
| `PHOTO_STORAGE_DIR` | Local disk path for uploaded photos (dev only -- swap for S3/Blob/GCS in `main.py`'s `upload_photo()` for production, Step 23) |
| `CORS_ALLOWED_ORIGINS` | Comma-separated list of allowed frontend origins |

## File overview

| File | Purpose |
|---|---|
| `main.py` | FastAPI app + all REST endpoints (Step 7) |
| `database.py` | SQLAlchemy engine/session setup |
| `models.py` | ORM models = the central schema (Step 5): users, farmers, farms, surveys, crop_observations, production_estimates, photos, sync_log, audit_log |
| `schemas.py` | Pydantic request/response models |
| `auth.py` | Password hashing (PBKDF2-HMAC-SHA256, stdlib only) + JWT issuing/verification + role permission matrix (Step 9) |
| `sync.py` | Idempotent upsert logic (Step 8), GPS validation (Step 10), data-quality classification (Step 12) |
| `migrations/001_postgis_setup.sql` | Optional PostGIS enablement (Step 11) |
| `tests/test_backend.py` | 27 automated checks, run via TestClient (no live server needed) |
