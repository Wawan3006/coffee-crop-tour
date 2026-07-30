"""
test_backend.py -- REAL execution test of the FastAPI backend using Starlette's
TestClient (in-process, no network needed, but exercises the actual app,
actual SQLAlchemy models, actual SQLite DB file, actual JWT auth).

Run:  python3 backend/tests/test_backend.py
"""
import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Use a throwaway SQLite file for this test run so it never touches any real DB.
TEST_DB_PATH = os.path.join(os.path.dirname(__file__), "test_backend.db")
if os.path.exists(TEST_DB_PATH):
    os.remove(TEST_DB_PATH)
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB_PATH}"
os.environ["JWT_SECRET_KEY"] = "test-secret-key-for-verification-only"
os.environ["PHOTO_STORAGE_DIR"] = os.path.join(os.path.dirname(__file__), "test_photo_storage")

from fastapi.testclient import TestClient  # noqa: E402
import main  # noqa: E402

# TestClient must be used as a context manager for FastAPI's startup event
# (which creates tables + seeds demo users) to actually fire.
client = TestClient(main.app)
client.__enter__()

results = []


def check(label, condition):
    status = "PASS" if condition else "FAIL"
    results.append((label, status))
    print(f"[{status}] {label}")


# ---------------------------------------------------------------------------
# 1. Health check
# ---------------------------------------------------------------------------
r = client.get("/api/health")
check("GET /api/health returns 200", r.status_code == 200)
check("health payload has status=ok", r.json().get("status") == "ok")

# ---------------------------------------------------------------------------
# 2. Login (Step 9) -- seeded demo users created on startup event
# ---------------------------------------------------------------------------
r = client.post("/api/login", json={"username": "surveyor1", "password": "demo"})
check("POST /api/login (correct password) returns 200", r.status_code == 200)
token_data = r.json()
check("login response includes access_token", "access_token" in token_data)
check("login response role == Field Surveyor", token_data.get("role") == "Field Surveyor")
SURVEYOR_TOKEN = token_data["access_token"]
SURVEYOR_ID = token_data["user_id"]

r_bad = client.post("/api/login", json={"username": "surveyor1", "password": "WRONG"})
check("POST /api/login (wrong password) returns 401", r_bad.status_code == 401)

r_mgr = client.post("/api/login", json={"username": "manager1", "password": "demo"})
MANAGER_TOKEN = r_mgr.json()["access_token"]

r_agro = client.post("/api/login", json={"username": "agronomist1", "password": "demo"})
AGRONOMIST_TOKEN = r_agro.json()["access_token"]

headers_surveyor = {"Authorization": f"Bearer {SURVEYOR_TOKEN}"}
headers_manager = {"Authorization": f"Bearer {MANAGER_TOKEN}"}
headers_agronomist = {"Authorization": f"Bearer {AGRONOMIST_TOKEN}"}

# ---------------------------------------------------------------------------
# 3. Auth enforcement: no token -> 401
# ---------------------------------------------------------------------------
r = client.get("/api/surveys")
check("GET /api/surveys without token returns 401", r.status_code == 401)

# ---------------------------------------------------------------------------
# 4. POST /api/sync -- create a brand-new survey (Step 7, 8)
# ---------------------------------------------------------------------------
SURVEY_UUID = str(uuid.uuid4())
sync_payload = {
    "device_id": "TEST-DEVICE-001",
    "surveyor_id": SURVEYOR_ID,
    "surveys": [
        {
            "survey_id": SURVEY_UUID,
            "province": "Lampung",
            "regency": "Lampung Barat",
            "district": "Sumber Jaya",
            "village": "Tugu Sari",
            "farmer_id": "F-000123",
            "farmer_name": "Ahmad Yani",
            "latitude": -4.9,
            "longitude": 104.3,
            "gps_accuracy": 7.0,
            "farm_area_ha": 1.5,
            "coffee_species": "Robusta",
            "tree_population": 1800,
            "production_last_year_kg": 1100,
            "production_current_estimate_kg": 1200,
            "survey_date": "2026-07-20",
            "crop_year": "2026/27",
            "version_number": 1,
            "local_updated_at": "2026-07-20T09:00:00",
        }
    ],
}
r = client.post("/api/sync", json=sync_payload, headers=headers_surveyor)
check("POST /api/sync (first upload) returns 200", r.status_code == 200)
sync_resp = r.json()
check("sync response records_created == 1", sync_resp["records_created"] == 1)
check("sync response result[0] == CREATED", sync_resp["results"][0]["result"] == "CREATED")

# ---------------------------------------------------------------------------
# 5. IDEMPOTENCY TEST (Step 8) -- upload the SAME survey_id 2 more times
# ---------------------------------------------------------------------------
for i in range(2):
    r = client.post("/api/sync", json=sync_payload, headers=headers_surveyor)
    check(f"re-upload #{i+1} of identical survey_id returns 200", r.status_code == 200)

r_final = client.get("/api/surveys", headers=headers_surveyor)
all_surveys = r_final.json()
matching = [s for s in all_surveys if s["id"] == SURVEY_UUID]
check("EXACTLY ONE row exists after uploading same survey_id 3 times (idempotency)", len(matching) == 1)
if matching:
    check("version_number incremented on repeated sync (not stuck at 1)", matching[0]["version_number"] > 1)

# ---------------------------------------------------------------------------
# 6. GPS validation / data quality (Step 10, 12)
# ---------------------------------------------------------------------------
if matching:
    check("data_quality_status computed as VALID for good record", matching[0]["data_quality_status"] == "VALID")

BAD_GPS_UUID = str(uuid.uuid4())
bad_gps_payload = {
    "device_id": "TEST-DEVICE-001",
    "surveyor_id": SURVEYOR_ID,
    "surveys": [{
        "survey_id": BAD_GPS_UUID,
        "province": "Lampung",
        "latitude": 51.5,   # London -- outside Indonesia bbox
        "longitude": -0.12,
        "farm_area_ha": 1.0,
        "production_current_estimate_kg": 500,
        "survey_date": "2026-07-20",
        "crop_year": "2026/27",
    }],
}
r = client.post("/api/sync", json=bad_gps_payload, headers=headers_surveyor)
check("sync of out-of-Indonesia GPS returns 200 (accepted but flagged)", r.status_code == 200)
check("out-of-Indonesia record flagged REVIEW_REQUIRED",
      r.json()["results"][0]["data_quality_status"] == "REVIEW_REQUIRED")

DUP_COORD_UUID = str(uuid.uuid4())
dup_payload = {
    "device_id": "TEST-DEVICE-002",
    "surveyor_id": SURVEYOR_ID,
    "surveys": [{
        "survey_id": DUP_COORD_UUID,
        "province": "Lampung",
        "latitude": -4.9, "longitude": 104.3,  # identical to SURVEY_UUID above
        "farmer_id": "F-999999", "farmer_name": "Different Farmer",
        "farm_area_ha": 2.0,
        "production_current_estimate_kg": 800,
        "survey_date": "2026-07-21",
        "crop_year": "2026/27",
    }],
}
r = client.post("/api/sync", json=dup_payload, headers=headers_surveyor)
check("duplicate-coordinate sync returns 200", r.status_code == 200)
check("duplicate coordinate flagged WARNING (not VALID)",
      r.json()["results"][0]["data_quality_status"] in ("WARNING", "REVIEW_REQUIRED"))

# ---------------------------------------------------------------------------
# 7. Role-based access control (Step 9)
# ---------------------------------------------------------------------------
r = client.get("/api/users", headers=headers_surveyor)
check("Field Surveyor CANNOT list users (403)", r.status_code == 403)

r = client.get("/api/users", headers=headers_manager)
check("Manager also CANNOT manage users (403, only Administrator can)", r.status_code == 403)

r_admin = client.post("/api/login", json={"username": "admin1", "password": "demo"})
ADMIN_TOKEN = r_admin.json()["access_token"]
r = client.get("/api/users", headers={"Authorization": f"Bearer {ADMIN_TOKEN}"})
check("Administrator CAN list users (200)", r.status_code == 200)
check("4 seeded demo users present", len(r.json()) == 4)

# ---------------------------------------------------------------------------
# 8. Agronomist estimate adjustment permission (Step 9, 27)
# ---------------------------------------------------------------------------
# Fetch the current version first (it has advanced due to the 3 syncs above,
# per optimistic-lock rules) so this PUT isn't itself mistaken for a conflict.
current_version = client.get(f"/api/surveys/{SURVEY_UUID}", headers=headers_surveyor).json()["version_number"]

r = client.put(f"/api/surveys/{SURVEY_UUID}",
               json={"agronomist_adjusted_estimate_kg": 1350.0, "adjustment_reason": "Field cross-check", "version_number": current_version},
               headers=headers_surveyor)
check("Field Surveyor CANNOT adjust estimate (403)", r.status_code == 403)

r = client.put(f"/api/surveys/{SURVEY_UUID}",
               json={"agronomist_adjusted_estimate_kg": 1350.0, "adjustment_reason": "Field cross-check", "version_number": current_version},
               headers=headers_agronomist)
check("Agronomist CAN adjust estimate (200)", r.status_code == 200)

# ---------------------------------------------------------------------------
# 9. GET /api/regions aggregation (Step 14)
# ---------------------------------------------------------------------------
r = client.get("/api/regions", headers=headers_manager)
check("GET /api/regions returns 200", r.status_code == 200)
regions = r.json()
check("regions include Lampung with survey_count > 0",
      any(reg["province"] == "Lampung" and reg["survey_count"] > 0 for reg in regions))

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
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
else:
    print("ALL BACKEND TESTS PASSED")
