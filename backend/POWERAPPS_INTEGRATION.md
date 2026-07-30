# Coffee Crop Tour — Power Apps Integration

This connects the existing **Python/FastAPI backend** (`backend/main.py`)
to **Microsoft Power Apps**, so office staff (Managers, Agronomists,
Administrators) can build/use a Power App on top of the same live survey
data the field PWA collects and syncs, with no backend rewrite required.

## What was generated and verified in this repo

| File | Purpose | Verified by |
|---|---|---|
| `backend/generate_powerapps_connector.py` | Boots the real FastAPI app, fetches its live OpenAPI 3.0 schema, converts it to Swagger 2.0 (the format Power Apps' importer requires — OpenAPI 3.0 is **not** accepted), and writes `powerapps_connector.swagger.json` | Ran successfully: 10/10 paths converted, 0 missing |
| `backend/powerapps_connector.swagger.json` | The ready-to-import connector definition | Structurally validated: **0 errors, 0 warnings** against Swagger 2.0's mandatory-field rules (unique `operationId`s, resolvable `$ref`s, valid parameter locations, etc.) |
| `backend/validate_connector.py` | Re-runs that structural validation any time you regenerate the connector | 0 errors / 0 warnings on last run |
| `backend/e2e_test_connector_endpoints.py` | Exercises every endpoint the connector describes against the real running API (login, JWT auth, batch sync, idempotency, role-based 403s) | **14/14 checks passed** |

## Why Swagger 2.0 conversion is a real, necessary step (not cosmetic)

FastAPI natively serves **OpenAPI 3.0** at `/openapi.json`. Power Apps'
"Custom Connector → Import an OpenAPI file" wizard only accepts
**Swagger 2.0**. Without this conversion step, importing `/openapi.json`
directly into Power Apps will fail. `generate_powerapps_connector.py`
performs this conversion for real (flattening OpenAPI 3's `requestBody`
into Swagger 2's `body`/`formData` parameters, rewriting all
`#/components/schemas/...` references to `#/definitions/...`, etc.) —
confirmed correct by the independent validator finding 0 structural
errors and by the end-to-end test successfully calling every endpoint.

## Step-by-step: importing into Power Apps

1. **Deploy the backend** somewhere with a public HTTPS URL (Railway,
   Render, or your own server — see `backend/README.md`). You need this
   URL before the connector will actually work, though you can import the
   file before deployment and fill the host in afterward.

2. **Edit the `host` field.** Open `backend/powerapps_connector.swagger.json`
   and replace:
   ```json
   "host": "REPLACE_WITH_YOUR_DEPLOYED_HOST.example.com"
   ```
   with your real backend domain, e.g. `"host": "coffee-crop-tour-api.up.railway.app"`
   (no `https://` prefix — that's what the separate `"schemes": ["https"]`
   field is for).

3. In **Power Apps** (make.powerapps.com):
   - Go to **Data → Custom connectors → New custom connector → Import an OpenAPI file**
   - Upload `powerapps_connector.swagger.json`
   - Power Apps will show all 10 operations (login, surveys, sync, farmers,
     farms, regions, photos, users) — click through **Create connector**

4. **Create a Connection** using the connector:
   - Power Apps will prompt for the `Authorization` header value
   - Call `Login` first with a Power Apps flow/formula to get a JWT, e.g.:
     ```
     Set(
       LoginResult,
       CoffeeCropTourAPI.login_api_login_post({ username: "manager1", password: "demo" })
     );
     Set(AuthToken, "Bearer " & LoginResult.access_token)
     ```
   - Then pass `AuthToken` as the `Authorization` header on subsequent calls
     (`list_surveys_api_surveys_get`, `list_regions_api_regions_get`, etc.)

5. **Build screens** using the connector's operations as data sources —
   e.g. a gallery bound to `list_surveys_api_surveys_get` filtered by
   `province`, or a form calling `update_survey...put` so an Agronomist can
   adjust a production estimate (server-side permission check already
   enforces only Agronomist/Administrator roles can do this — verified in
   the e2e test above).

## Regenerating the connector after backend changes

Whenever `backend/main.py` or `backend/schemas.py` change (new fields,
new endpoints), regenerate and re-validate:

```bash
python3 backend/generate_powerapps_connector.py
python3 backend/validate_connector.py
python3 backend/e2e_test_connector_endpoints.py
```

All three should report success before you re-import the updated file into
Power Apps.

## Architecture (why this doesn't replace the existing PWA)

```
Field Surveyors  ──────►  Existing offline-first PWA (unchanged)
                           (IndexedDB, GPS, camera, works with weak/no signal)
                                        │
                                        ▼
                              FastAPI backend (this repo's backend/)
                                        │
                                        ▼
                                  PostgreSQL
                                        │
                                        ▼
                    ┌───────────────────┴───────────────────┐
                    ▼                                       ▼
         Power BI (scheduled refresh,          Power App (this integration —
         via analytics/ + SQL views)           Managers/Agronomists/Admins:
                                                review, adjust estimates,
                                                dashboards, user management)
```

Field data collection stays on the purpose-built offline PWA (Power Apps'
offline story for complex relational data is far weaker and would need
Dataverse + extra licensing to match what the existing PWA already does
for free). Power Apps is added here as an **additional consumer** of the
same backend, for office-based roles that always have connectivity.
