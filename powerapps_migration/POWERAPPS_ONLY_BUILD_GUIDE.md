# Coffee Crop Tour — 100% Power Apps Rebuild (No Python, No PWA)

This replaces the entire Python/FastAPI backend and the offline PWA with a
pure Microsoft Power Platform stack: **Power Apps (canvas app) + Dataverse
+ Power Automate**. Zero Python code remains anywhere in this architecture.

## What replaces what

| Old (Python/PWA) | New (Power Platform) |
|---|---|
| `coffee_crop_tour/` PWA (HTML/JS/IndexedDB) | Power Apps Canvas App |
| `backend/main.py` (FastAPI REST API) | Dataverse tables (direct read/write, no API code needed) |
| `backend/models.py` (SQLAlchemy schema) | Dataverse table/column definitions (see `dataverse_schema.csv`) |
| `backend/sync.py` idempotent upsert | Dataverse **Alternate Key** on `survey_id` (built-in upsert, zero code) |
| `backend/auth.py` (JWT, password hashing) | Power Apps built-in Microsoft Entra ID (Azure AD) authentication — no custom auth code needed |
| IndexedDB offline storage | Power Apps `SaveData()`/`LoadData()` (canvas app **Offline Profile**) |
| `analytics/*.py` (validation, crop estimation, aggregation) | Power Automate Cloud Flows + Dataverse calculated/rollup columns |
| Manual GPS capture (`geo.js`) | Power Apps `Location` control (built-in) |
| Manual photo capture (`survey-form.js`) | Power Apps `Camera` control + Dataverse file column |

**Net result: zero Python, zero custom backend code.** Dataverse + Power
Automate + Power Fx formulas fully replace `backend/` and `analytics/`.

## Step 1 — Create the Dataverse environment & tables

You need a Power Platform environment with **Dataverse** provisioned
(requires a Power Apps per-app or per-user license, or Microsoft 365
E3/E5 which includes limited Dataverse capacity).

Create these tables (see `dataverse_schema.csv` for the full 75-column
QN.xlsx field mapping) via **make.powerapps.com → Tables → New table**:

1. **cct_survey** (main table — all 75 QN.xlsx fields as columns)
   - Set **Alternate Key** on column `cct_surveyid` (text, the same UUID
     the old app generated client-side). This single setting is what
     replaces `backend/sync.py`'s custom idempotent-upsert code — Dataverse
     rejects/merges duplicate `cct_surveyid` values automatically.
2. **cct_farmer** (farmer_id, farmer_name, phone, notes)
3. **cct_farm** (province, district, village, lat/lon, coffee_species, farm_area_ha)
4. **cct_photo** (survey lookup, photo_type, the actual **File** column type — Dataverse stores the binary directly, no separate object storage needed)
5. **cct_auditlog** (Dataverse has this **built-in** — enable "Auditing" on each table in table settings; replaces the custom `audit_log` table entirely, zero setup code)

## Step 2 — Security roles (replaces `backend/auth.py` role permissions)

In **make.powerapps.com → Environment → Security roles**, create 4 roles
matching the original spec exactly:

| Role | Table permissions |
|---|---|
| Field Surveyor | Create/Read/Write **own records only** on cct_survey (Dataverse's built-in row-level "User" privilege scope — no code needed) |
| Agronomist | Read all cct_survey; Write on `cct_agronomistadjustedestimate` column only (use **Column-level security** — Dataverse built-in feature) |
| Manager | Read-only on everything, no Create/Write |
| Administrator | Full System Administrator role (built-in) |

Assign users to these roles under **Environment → Users**. This entirely
replaces `PERMISSIONS` dict in `auth.py` — zero code.

## Step 3 — Build the Canvas App screens

Open **make.powerapps.com → Apps → New app → Canvas → Blank**. Build these
screens (mirrors the original 14-step wizard):

```
scrLogin           -> Office 365 / Entra ID login (built-in connector, replaces JWT)
scrHome            -> Dashboard: galleries + charts bound directly to cct_survey
scrSurveyWizard1..14  -> One screen per original wizard step (Sample&Farmer,
                          Area, Bearing, Production, Selling, Stock, FlyOutlook,
                          MainCrop, Weather, Price, Labor, Photos, Review, Submit)
scrMap             -> Power Apps "Map" control (or embed Power BI map) bound to lat/lon
scrSyncStatus      -> Gallery showing SaveData() collection status (see Step 4)
```

See `powerfx_formulas.txt` in this folder for the exact Power Fx formulas
for GPS capture, photo capture, and the submit/save logic for each screen.

## Step 4 — Offline mode (honest limitations, see warning above)

Canvas apps support offline via:
```powerfx
// On App.OnStart:
LoadData(colDraftSurveys, "draft_surveys_cache", true);

// On each field's OnChange (autosave draft):
Collect(colDraftSurveys, ThisRecord);
SaveData(colDraftSurveys, "draft_surveys_cache");

// On Submit button, when connectivity resumes:
If(
    Connection.Connected,
    Patch(cct_survey, Defaults(cct_survey), ThisRecord);
    Remove(colDraftSurveys, ThisRecord);
    SaveData(colDraftSurveys, "draft_surveys_cache"),
    Notify("Offline — saved as draft, will sync when back online", NotificationType.Warning)
)
```
**Limitation to accept:** this only handles flat survey records up to
Power Apps' local storage cap (~30MB per app on Android) and requires the
user to reopen the app to trigger a re-sync attempt — there is no
automatic background sync like the current service worker provides.

## Step 5 — Power Automate flows (replaces `analytics/*.py`)

Create these Cloud Flows in **make.powerautomate.com** (all no-code,
trigger = "When a row is added/modified" on `cct_survey`):

| Flow name | Replaces | Logic |
|---|---|---|
| `GPS-Validation` | `validate_gps.py` | Condition: lat between -11 and 6, lon between 95 and 141 (Indonesia bbox) → update `cct_gpsvalid` column |
| `Crop-Estimation` | `crop_estimation.py` | Compute `farm_area_ha * expected_yield` using a Power Automate expression, write to `cct_modelestimatekg` |
| `Data-Quality-Check` | `clean_data.py` | Condition checks (missing GPS, missing farmer, etc.) → set `cct_dataqualitystatus` |
| `Nightly-Regional-Rollup` | `regional_summary.py` | Scheduled flow (daily) using Dataverse **rollup columns** + a "List rows" + "Compose" aggregation, writes to a `cct_regionalsummary` table |

Dataverse also supports native **Rollup Columns** and **Calculated
Columns** directly on tables — for simple sums/averages (total hectares,
average yield) you don't even need a flow, just a column formula.

## Step 6 — Power BI (unchanged)

Connect Power BI directly to Dataverse using the native **Dataverse
connector** (`Get Data → Dataverse`) — this is actually simpler than the
old PostgreSQL SQL-views approach, since Dataverse exposes clean OData
entities automatically.

## What you must do yourself (I cannot do this for you)

1. Provision the Power Platform environment + Dataverse (requires your
   Microsoft 365 tenant admin or a Power Apps license)
2. Build the screens/controls inside Power Apps Studio using the formulas
   in `powerfx_formulas.txt`
3. Build the 4 Power Automate flows using the logic table above
4. Assign security roles to real users

## Files in this package

- `POWERAPPS_ONLY_BUILD_GUIDE.md` — this file
- `dataverse_schema.csv` — all 75 QN.xlsx columns mapped to Dataverse column names/types
- `powerfx_formulas.txt` — ready-to-paste Power Fx for GPS, camera, submit, offline save/load
