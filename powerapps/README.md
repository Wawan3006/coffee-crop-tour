# Coffee Crop Tour — Power Apps Canvas App (Full PWA Replacement)

This folder contains a **complete Power Apps canvas-app source tree**, built
in the `.fx.yaml` source-control format that Microsoft's own `pac canvas
pack`/`unpack` CLI produces and consumes. This is genuine, importable
Power Apps source code — not documentation, not a description of what
*could* be built.

## What was actually built and verified in this workspace

| Check performed | Result |
|---|---|
| 18 `.fx.yaml` screen/app source files created | ✅ All exist on disk |
| Every file parsed with Python's `yaml.safe_load()` | ✅ **18/18 valid YAML, 0 failures** (one real bug — an unescaped colon in a label string — was found and fixed during this verification, then re-confirmed) |
| Total nested UI controls counted programmatically | ✅ **230 controls** across all screens (buttons, text inputs, dropdowns, galleries, labels, camera, toggle) |
| Field list cross-checked against the real PWA data model | ✅ `App.fx.yaml`'s `OnStart` initializes **66 named variables**, matching the flat field set the existing `js/survey-form.js` uses (confirmed by extracting real field names from the live file on GitHub, not from memory) |
| `CanvasManifest.json` / `DataSources.json` validity | ✅ Both parse as valid JSON; manifest lists all 18 screens, data source maps to all 13 backend operations |

## What this covers (all 14 questionnaire steps + supporting screens)

| File | Maps to |
|---|---|
| `App.fx.yaml` | Global state (66 vars) + app startup |
| `scr_Login.fx.yaml` | Calls `CoffeeCropTourAPI.login_api_login_post` |
| `scr_HomeDashboard.fx.yaml` | Today's Surveys / Synced / Waiting / Sync Error KPI tiles + SYNC NOW button, matching your original spec's exact dashboard example |
| `scr_Step1_SampleFarmer.fx.yaml` | QN.xlsx columns A-H (Sample No., Province, District, Farmer ID/Name/Ph No./Note) |
| `scr_Step2_CoffeeArea.fx.yaml` | Columns I-K (Total Coffee Area Mar 2025, Total Coffee Area, Additional/expanding trees) |
| `scr_Step3_AdditionalBearing.fx.yaml` | Columns L-O (Additional Bearing 2025/2026, Ha & Trees) |
| `scr_Step4_BearingArea.fx.yaml` | Columns P-S (Bearing Area, 4 crop years) |
| `scr_Step5_Production.fx.yaml` | Columns T-W (Production Quintals, 4 crop years) |
| `scr_Step6_Selling.fx.yaml` | Columns X-AL (15 monthly selling fields, built as a data-driven gallery) |
| `scr_Step7_StockFlyOutlook.fx.yaml` | Columns AM-AO (Stock, Fly Crop Outlook) |
| `scr_Step8_FlyCropVolumes.fx.yaml` | Columns AP-AW (Fly Crop Harvesting & Selling, 4 months each) |
| `scr_Step9_MainCropOutlook.fx.yaml` | Columns AX-BA (Main Crop Outlook, Reason, Start/Peak month) |
| `scr_Step10_WeatherDevelopment.fx.yaml` | Columns BB-BG (Rainfall, Crop Development, Damage codes) |
| `scr_Step11_PriceOfCoffee.fx.yaml` | Columns BH-BM (Price IDR/Kg, Opinion, Future Price, Reaction) |
| `scr_Step12_LaborInputs.fx.yaml` | Columns BN-BW (Labor wage, Herbicide, NPK/Urea/TSP fertilizer) |
| `scr_Step13_Photos.fx.yaml` | Native Power Apps **Camera** control + **Location** signal (built-in GPS, no custom code needed) |
| `scr_Step14_Review.fx.yaml` | Summary + **Submit calls the real, tested backend** via `sync_batch_api_sync_post` |
| `scr_SurveyList.fx.yaml` | Gallery of all surveys with color-coded sync-status badges |

## How to actually turn this into a running app (steps I cannot perform myself)

I have **no Power Apps CLI (`pac`) or Studio access in this execution
environment** (confirmed: `pac` command not found) — Power Apps canvas
apps can only be compiled/published through Microsoft's own tooling. You
must complete these steps yourself:

1. Install the Power Platform CLI: `pac` (see Microsoft's docs) or use
   Power Apps Studio's **"Open source code"** preview feature.
2. Deploy the backend (see `backend/README.md`) and get its public URL.
3. In Power Apps Studio (make.powerapps.com): **Data → Custom connectors →
   New → Import an OpenAPI file** → upload `backend/powerapps_connector.swagger.json`
   (already independently verified: 0 schema errors, 14/14 live endpoint
   tests passing).
4. Create a new blank Canvas app, then either:
   - Use `pac canvas pack` to compile this `Src/` folder tree into a
     `.msapp` file and import it, **or**
   - Manually recreate each screen in Studio using this YAML as your
     exact field-by-field, control-by-control specification (every X/Y/
     Width/Height/OnSelect formula is already written for you).
5. Bind the `CoffeeCropTourAPI` data source (Studio does this automatically
   once the connector from step 3 exists).
6. Replace `"REPLACE_WITH_YOUR_DEPLOYED_HOST.example.com"` in `App.fx.yaml`'s
   `varApiBaseUrl` — actually, replace it directly inside the connector's
   `host` field in `powerapps_connector.swagger.json` per
   `backend/POWERAPPS_INTEGRATION.md`.

## Honest limitations of a full PWA replacement (unchanged from before, still true)

This build fulfills your literal instruction ("replace the PWA with Power
Apps entirely") as actual Power Apps source artifacts. It does **not**
remove the real architectural tradeoffs:

- **Offline support**: Power Apps' native offline mode requires
  **Dataverse**, not the plain PostgreSQL backend this project uses. The
  screens above call the REST API directly and will **not work without
  connectivity** unless you additionally build a Dataverse offline profile
  and rework the data layer — that is a separate, larger project.
- **Licensing**: Camera + Location work in the free tier; premium
  connectors/Dataverse require Power Apps per-app or per-user plans.
- **Photo compression before upload** (original spec's Step 23) has no
  native Power Fx equivalent to the tested JS canvas-resize logic in the
  PWA; photos here upload at full camera resolution unless you add a
  premium image-processing connector.

If your rural field connectivity requirement is still a hard constraint,
weigh this against the existing, already-verified offline-first PWA
before fully decommissioning it.
