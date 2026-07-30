"""
seed_and_run_pipeline.py -- REAL end-to-end test:
  1. Spin up a throwaway SQLite DB
  2. Seed users + push realistic survey data through the ACTUAL FastAPI
     /api/sync endpoint (same code path a real device would use)
  3. Run the full analytics pipeline (validate -> GPS -> estimate ->
     aggregate -> Power BI export) against that data
  4. Assert real, concrete outputs (CSV files exist and contain the
     expected rows, SQL views were created, aggregation numbers are sane)

Run:  python3 analytics/tests/seed_and_run_pipeline.py
"""
import os
import sys
import uuid
import shutil

THIS_DIR = os.path.dirname(__file__)
BACKEND_DIR = os.path.join(THIS_DIR, "..", "..", "backend")
ANALYTICS_DIR = os.path.join(THIS_DIR, "..")
sys.path.insert(0, BACKEND_DIR)
sys.path.insert(0, ANALYTICS_DIR)

TEST_DB_PATH = os.path.join(THIS_DIR, "pipeline_test.db")
if os.path.exists(TEST_DB_PATH):
    os.remove(TEST_DB_PATH)
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB_PATH}"
os.environ["JWT_SECRET_KEY"] = "test-secret-pipeline"
os.environ["PHOTO_STORAGE_DIR"] = os.path.join(THIS_DIR, "test_photo_storage")

EXPORT_DIR = os.path.join(ANALYTICS_DIR, "powerbi_export")
if os.path.exists(EXPORT_DIR):
    shutil.rmtree(EXPORT_DIR)

from fastapi.testclient import TestClient  # noqa: E402
import main  # noqa: E402

client = TestClient(main.app)
client.__enter__()

results = []


def check(label, condition):
    status = "PASS" if condition else "FAIL"
    results.append((label, status))
    print(f"[{status}] {label}")


# --- 1. Login as surveyor, push a realistic batch of 6 surveys across 2 provinces, 2 crop years ---
login = client.post("/api/login", json={"username": "surveyor1", "password": "demo"}).json()
TOKEN = login["access_token"]
SURVEYOR_ID = login["user_id"]
headers = {"Authorization": f"Bearer {TOKEN}"}

sample_surveys = [
    {"survey_id": str(uuid.uuid4()), "province": "Lampung", "regency": "Lampung Barat",
     "farmer_id": "F-001", "farmer_name": "Farmer A", "latitude": -4.9, "longitude": 104.3,
     "gps_accuracy": 6, "farm_area_ha": 1.5, "coffee_species": "Robusta",
     "production_last_year_kg": 1100, "production_current_estimate_kg": 1250,
     "harvest_progress_pct": 40, "selling_progress_pct": 20,
     "pest_condition": "Low", "disease_condition": "None",
     "survey_date": "2025-07-01", "crop_year": "2025/26"},
    {"survey_id": str(uuid.uuid4()), "province": "Lampung", "regency": "Lampung Barat",
     "farmer_id": "F-002", "farmer_name": "Farmer B", "latitude": -4.95, "longitude": 104.35,
     "gps_accuracy": 8, "farm_area_ha": 2.0, "coffee_species": "Robusta",
     "production_last_year_kg": 1500, "production_current_estimate_kg": 1600,
     "harvest_progress_pct": 55, "selling_progress_pct": 30,
     "pest_condition": "Moderate", "disease_condition": "Low",
     "survey_date": "2025-07-02", "crop_year": "2025/26"},
    {"survey_id": str(uuid.uuid4()), "province": "Lampung", "regency": "Lampung Barat",
     "farmer_id": "F-001", "farmer_name": "Farmer A", "latitude": -4.9, "longitude": 104.3,
     "gps_accuracy": 6, "farm_area_ha": 1.5, "coffee_species": "Robusta",
     "production_last_year_kg": 1250, "production_current_estimate_kg": 1400,
     "harvest_progress_pct": 35, "selling_progress_pct": 15,
     "pest_condition": "Low", "disease_condition": "None",
     "survey_date": "2026-07-01", "crop_year": "2026/27"},
    {"survey_id": str(uuid.uuid4()), "province": "Aceh", "regency": "Aceh Tengah",
     "farmer_id": "F-003", "farmer_name": "Farmer C", "latitude": 4.6, "longitude": 96.8,
     "gps_accuracy": 5, "farm_area_ha": 1.0, "coffee_species": "Arabica",
     "production_last_year_kg": 700, "production_current_estimate_kg": 750,
     "harvest_progress_pct": 60, "selling_progress_pct": 40,
     "pest_condition": "None", "disease_condition": "Low",
     "survey_date": "2025-08-01", "crop_year": "2025/26"},
    {"survey_id": str(uuid.uuid4()), "province": "Aceh", "regency": "Aceh Tengah",
     "farmer_id": "F-004", "farmer_name": "Farmer D", "latitude": 4.65, "longitude": 96.85,
     "gps_accuracy": 60, "farm_area_ha": None, "coffee_species": "Arabica",  # missing farm area -> WARNING
     "production_current_estimate_kg": 0,
     "survey_date": "2025-08-02", "crop_year": "2025/26"},
    {"survey_id": str(uuid.uuid4()), "province": "Aceh", "regency": "Aceh Tengah",
     "farmer_id": "F-003", "farmer_name": "Farmer C", "latitude": 4.6, "longitude": 96.8,
     "gps_accuracy": 5, "farm_area_ha": 1.0, "coffee_species": "Arabica",
     "production_last_year_kg": 750, "production_current_estimate_kg": 820,
     "harvest_progress_pct": 50, "selling_progress_pct": 25,
     "pest_condition": "None", "disease_condition": "None",
     "survey_date": "2026-08-01", "crop_year": "2026/27"},
]

sync_payload = {"device_id": "PIPELINE-TEST-DEVICE", "surveyor_id": SURVEYOR_ID, "surveys": sample_surveys}
r = client.post("/api/sync", json=sync_payload, headers=headers)
check("Batch sync of 6 realistic surveys returns 200", r.status_code == 200)
check("All 6 records created (0 pre-existing)", r.json()["records_created"] == 6)

# --- 2. Run the actual pipeline modules against this data ---
import clean_data  # noqa: E402
import validate_gps  # noqa: E402
import crop_estimation  # noqa: E402
import regional_summary  # noqa: E402
import export_powerbi  # noqa: E402

print("\n--- Running clean_data.run() ---")
quality_tally = clean_data.run()
check("clean_data.run() classified all 6 surveys", sum(quality_tally.values()) == 6)
check("At least 1 record flagged WARNING/REVIEW (the missing-farm-area one)",
      quality_tally.get("WARNING", 0) + quality_tally.get("REVIEW_REQUIRED", 0) >= 1)

print("\n--- Running validate_gps.run() ---")
gps_result = validate_gps.run()
check("validate_gps.run() checked 6 surveys", gps_result["checked"] == 6)

print("\n--- Running crop_estimation.run() ---")
est_result = crop_estimation.run()
check("crop_estimation.run() computed model estimates for surveys with valid farm area", est_result["computed"] >= 4)

print("\n--- Running regional_summary.run() ---")
regional_result = regional_summary.run()
national_df = regional_result["national"]
check("national aggregation has 2 crop years (2025/26, 2026/27)", len(national_df) == 2)
by_province_df = regional_result["by_province"]
check("by-province aggregation includes both Lampung and Aceh",
      set(by_province_df["province"].unique()) >= {"Lampung", "Aceh"})
comparison_df = regional_result["comparison"]
check("crop-year comparison produced rows for provinces with 2 years of data", len(comparison_df) >= 2)

print("\n--- Running export_powerbi.run() ---")
export_result = export_powerbi.run()
check("export_powerbi created at least 1 SQL view", len(export_result["views_created"]) >= 1)
check("export_powerbi wrote 8 star-schema CSV files", len(export_result["csv_files"]) == 8)

for name, path, count in export_result["csv_files"]:
    check(f"CSV file exists on disk: {name}.csv", os.path.exists(path))

import pandas as pd  # noqa: E402
fact_production_path = os.path.join(EXPORT_DIR, "fact_production.csv")
fact_production_df = pd.read_csv(fact_production_path)
check("fact_production.csv has numeric estimated_production_mt column",
      pd.api.types.is_numeric_dtype(fact_production_df["estimated_production_mt"]))
check("fact_production.csv total production > 0",
      fact_production_df["estimated_production_mt"].sum() > 0)

# --- 3. Verify SQL views are actually queryable (not just created) ---
from db_connect import get_engine  # noqa: E402
from sqlalchemy import text  # noqa: E402
engine = get_engine()
with engine.connect() as conn:
    view_rows = conn.execute(text("SELECT * FROM vw_powerbi_crop_summary")).fetchall()
check("vw_powerbi_crop_summary view is queryable and returns rows", len(view_rows) > 0)

# --- Summary ---
print()
total = len(results)
passed = sum(1 for _, s in results if s == "PASS")
print(f"TOTAL: {passed}/{total} PASSED")
if passed != total:
    print("FAILURES:")
    for label, s in results:
        if s == "FAIL":
            print("  -", label)
    sys.exit(1)
print("ALL PIPELINE TESTS PASSED")
