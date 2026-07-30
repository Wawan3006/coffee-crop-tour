"""
main.py -- FastAPI application entrypoint (Step 6, 7).

Run locally (see README.md in this backend/ folder for full instructions):
    cd backend
    cp .env.example .env      # then edit .env with real secrets
    uvicorn main:app --reload --port 8000

By default (no DATABASE_URL set) this runs against a local SQLite file
(coffee_crop_tour_dev.db) with zero external setup, so the whole API can be
smoke-tested immediately. Point DATABASE_URL at a real PostgreSQL instance
for production (see .env.example and Step 4).
"""
import os
import uuid
import shutil
from datetime import datetime
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func

from database import get_db, init_db, engine
import models
import schemas
import auth
import sync as sync_module

app = FastAPI(title="Coffee Crop Tour API", version="1.0.0")

_origins_env = os.environ.get("CORS_ALLOWED_ORIGINS", "*")
_origins = [o.strip() for o in _origins_env.split(",")] if _origins_env != "*" else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PHOTO_STORAGE_DIR = os.environ.get("PHOTO_STORAGE_DIR", "./photo_storage")


@app.on_event("startup")
def on_startup():
    init_db()
    os.makedirs(PHOTO_STORAGE_DIR, exist_ok=True)
    _ensure_seed_users()


def _ensure_seed_users():
    """Create the 4 demo role accounts on first run, matching the app's
    existing demo logins, but now with real server-side password hashing."""
    db = next(get_db())
    try:
        if db.query(models.User).count() > 0:
            return
        seed = [
            ("surveyor1", "Budi Santoso", models.UserRole.FIELD_SURVEYOR),
            ("agronomist1", "Dewi Anggraini", models.UserRole.AGRONOMIST),
            ("manager1", "Rudi Hartono", models.UserRole.MANAGER),
            ("admin1", "Siti Nurhaliza", models.UserRole.ADMINISTRATOR),
        ]
        for username, full_name, role in seed:
            db.add(models.User(
                username=username, full_name=full_name, role=role,
                password_hash=auth.hash_password("demo"),
            ))
        db.commit()
    finally:
        db.close()


@app.get("/api/health")
def health_check():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}


# ---------------------------------------------------------------------------
# POST /api/login
# ---------------------------------------------------------------------------

@app.post("/api/login", response_model=schemas.LoginResponse)
def login(payload: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == payload.username).first()
    if not user or not auth.verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled")
    token = auth.create_access_token(user)
    role_val = user.role.value if hasattr(user.role, "value") else user.role
    return schemas.LoginResponse(
        access_token=token, user_id=user.id, username=user.username,
        full_name=user.full_name, role=role_val,
    )


# ---------------------------------------------------------------------------
# POST /api/surveys, GET /api/surveys, GET/PUT /api/surveys/{id}
# ---------------------------------------------------------------------------

@app.post("/api/surveys", response_model=schemas.SyncResultItem, status_code=status.HTTP_201_CREATED)
def create_survey(payload: schemas.SurveyIn, db: Session = Depends(get_db),
                   user: models.User = Depends(auth.get_current_user)):
    if not auth.has_permission(user.role.value if hasattr(user.role, "value") else user.role, "create_survey"):
        raise HTTPException(status_code=403, detail="Not permitted to create surveys")
    result = sync_module.upsert_survey(db, payload, user, device_id="single-record-api")
    db.commit()
    return result


@app.get("/api/surveys", response_model=List[schemas.SurveyOut])
def list_surveys(
    province: Optional[str] = None,
    crop_year: Optional[str] = None,
    surveyor_id: Optional[str] = None,
    sync_status: Optional[str] = None,
    data_quality_status: Optional[str] = None,
    limit: int = 200,
    offset: int = 0,
    db: Session = Depends(get_db),
    user: models.User = Depends(auth.get_current_user),
):
    q = db.query(models.Survey).filter(models.Survey.is_deleted.is_(False))
    role_val = user.role.value if hasattr(user.role, "value") else user.role
    if role_val == "Field Surveyor":
        q = q.filter(models.Survey.surveyor_id == user.id)  # own surveys only
    if province:
        q = q.filter(models.Survey.province == province)
    if crop_year:
        q = q.filter(models.Survey.crop_year == crop_year)
    if surveyor_id:
        q = q.filter(models.Survey.surveyor_id == surveyor_id)
    if sync_status:
        q = q.filter(models.Survey.sync_status == sync_status)
    if data_quality_status:
        q = q.filter(models.Survey.data_quality_status == data_quality_status)
    rows = q.order_by(models.Survey.server_updated_at.desc()).offset(offset).limit(limit).all()
    return [
        schemas.SurveyOut(
            id=r.id, sync_status=r.sync_status.value, data_quality_status=r.data_quality_status.value,
            province=r.province, regency=r.regency, district=r.district, farmer_id=r.farmer_id,
            latitude=r.latitude, longitude=r.longitude, survey_date=r.survey_date, crop_year=r.crop_year,
            version_number=r.version_number, server_updated_at=r.server_updated_at, has_conflict=r.has_conflict,
        ) for r in rows
    ]


@app.get("/api/surveys/{survey_id}", response_model=schemas.SurveyOut)
def get_survey(survey_id: str, db: Session = Depends(get_db),
                user: models.User = Depends(auth.get_current_user)):
    r = db.query(models.Survey).filter(models.Survey.id == survey_id, models.Survey.is_deleted.is_(False)).first()
    if not r:
        raise HTTPException(status_code=404, detail="Survey not found")
    return schemas.SurveyOut(
        id=r.id, sync_status=r.sync_status.value, data_quality_status=r.data_quality_status.value,
        province=r.province, regency=r.regency, district=r.district, farmer_id=r.farmer_id,
        latitude=r.latitude, longitude=r.longitude, survey_date=r.survey_date, crop_year=r.crop_year,
        version_number=r.version_number, server_updated_at=r.server_updated_at, has_conflict=r.has_conflict,
    )


@app.put("/api/surveys/{survey_id}", response_model=schemas.SurveyOut)
def update_survey(survey_id: str, payload: schemas.SurveyUpdate, db: Session = Depends(get_db),
                   user: models.User = Depends(auth.get_current_user)):
    r = db.query(models.Survey).filter(models.Survey.id == survey_id, models.Survey.is_deleted.is_(False)).first()
    if not r:
        raise HTTPException(status_code=404, detail="Survey not found")

    role_val = user.role.value if hasattr(user.role, "value") else user.role
    if payload.agronomist_adjusted_estimate_kg is not None and not auth.has_permission(role_val, "review_estimates"):
        raise HTTPException(status_code=403, detail="Only Agronomist/Administrator can adjust estimates")

    # Optimistic-lock conflict check (Step 25)
    if payload.version_number is not None and payload.version_number < r.version_number:
        raise HTTPException(status_code=409, detail="Version conflict: record was updated by someone else")

    old_snapshot = {"latitude": r.latitude, "longitude": r.longitude}

    if payload.latitude is not None:
        r.latitude = payload.latitude
    if payload.longitude is not None:
        r.longitude = payload.longitude
    if payload.data_quality_status is not None:
        r.data_quality_status = models.DataQualityStatus(payload.data_quality_status)

    est = db.query(models.ProductionEstimate).filter(models.ProductionEstimate.survey_id == r.id).first()
    if est is None:
        est = models.ProductionEstimate(survey_id=r.id, created_by=user.id, updated_by=user.id)
        db.add(est)
    if payload.production_current_estimate_kg is not None:
        est.surveyor_estimate_kg = payload.production_current_estimate_kg
    if payload.agronomist_adjusted_estimate_kg is not None:
        est.agronomist_adjusted_estimate_kg = payload.agronomist_adjusted_estimate_kg
        est.adjustment_reason = payload.adjustment_reason
        est.adjusted_by = user.id
        est.adjusted_at = datetime.utcnow()
        sync_module._write_audit(db, user, "ESTIMATE_ADJUSTED", "production_estimate", est.id,
                                  old_snapshot, payload.model_dump())

    r.version_number += 1
    r.server_updated_at = datetime.utcnow()
    r.updated_at = datetime.utcnow()
    r.updated_by = user.id
    db.commit()
    db.refresh(r)

    return schemas.SurveyOut(
        id=r.id, sync_status=r.sync_status.value, data_quality_status=r.data_quality_status.value,
        province=r.province, regency=r.regency, district=r.district, farmer_id=r.farmer_id,
        latitude=r.latitude, longitude=r.longitude, survey_date=r.survey_date, crop_year=r.crop_year,
        version_number=r.version_number, server_updated_at=r.server_updated_at, has_conflict=r.has_conflict,
    )


# ---------------------------------------------------------------------------
# POST /api/sync -- batch, idempotent (Step 3, 7, 8, 24, 28)
# ---------------------------------------------------------------------------

@app.post("/api/sync", response_model=schemas.SyncResponse)
def sync_batch(payload: schemas.SyncRequest, db: Session = Depends(get_db),
                user: models.User = Depends(auth.get_current_user)):
    run_id = str(uuid.uuid4())
    start_time = datetime.utcnow()
    results: List[schemas.SyncResultItem] = []
    created = updated = failed = 0

    for survey_in in payload.surveys:
        try:
            item = sync_module.upsert_survey(db, survey_in, user, device_id=payload.device_id)
            db.commit()
            results.append(item)
            if item.result == "CREATED":
                created += 1
            elif item.result == "UPDATED":
                updated += 1
        except Exception as exc:
            db.rollback()
            failed += 1
            results.append(schemas.SyncResultItem(
                survey_id=survey_in.survey_id, result="ERROR", message=str(exc),
            ))

    db.add(models.SyncLog(
        run_id=run_id, device_id=payload.device_id, surveyor_id=payload.surveyor_id or user.id,
        start_time=start_time, end_time=datetime.utcnow(),
        records_received=len(payload.surveys), records_created=created, records_updated=updated,
        records_valid=sum(1 for r in results if r.data_quality_status == "VALID"),
        records_warning=sum(1 for r in results if r.data_quality_status in ("WARNING", "REVIEW_REQUIRED")),
        records_failed=failed,
        processing_status="COMPLETED" if failed == 0 else "PARTIAL",
        detail=[r.model_dump() for r in results],
    ))
    db.commit()

    return schemas.SyncResponse(
        run_id=run_id, device_id=payload.device_id, records_received=len(payload.surveys),
        records_created=created, records_updated=updated, records_failed=failed, results=results,
    )


# ---------------------------------------------------------------------------
# POST /api/photos (Step 7, 23)
# ---------------------------------------------------------------------------

@app.post("/api/photos", response_model=schemas.PhotoOut, status_code=status.HTTP_201_CREATED)
async def upload_photo(
    survey_id: str = Form(...),
    photo_type: str = Form("Other"),
    latitude: Optional[float] = Form(None),
    longitude: Optional[float] = Form(None),
    captured_at: Optional[str] = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: models.User = Depends(auth.get_current_user),
):
    """Photos are stored as files (local disk in dev; swap this block for an
    object-storage upload -- S3/Blob/GCS -- in production, per Step 23) and
    only the resulting URL/path is written to the database, never the raw
    binary blob itself."""
    survey = db.query(models.Survey).filter(models.Survey.id == survey_id).first()
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")

    ext = os.path.splitext(file.filename or "photo.jpg")[1] or ".jpg"
    photo_id = str(uuid.uuid4())
    filename = f"{photo_id}{ext}"
    dest_path = os.path.join(PHOTO_STORAGE_DIR, filename)
    with open(dest_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    photo = models.Photo(
        id=photo_id, survey_id=survey_id, photo_type=photo_type,
        photo_url=f"/static/photos/{filename}",
        latitude=latitude, longitude=longitude,
        captured_at=sync_module._parse_dt(captured_at), created_by=user.id,
    )
    db.add(photo)
    db.commit()
    db.refresh(photo)
    return photo


# ---------------------------------------------------------------------------
# GET /api/farmers, GET /api/farms, GET /api/regions (Step 7)
# ---------------------------------------------------------------------------

@app.get("/api/farmers", response_model=List[schemas.FarmerOut])
def list_farmers(limit: int = 200, db: Session = Depends(get_db),
                  user: models.User = Depends(auth.get_current_user)):
    return db.query(models.Farmer).limit(limit).all()


@app.get("/api/farms", response_model=List[schemas.FarmOut])
def list_farms(province: Optional[str] = None, limit: int = 200, db: Session = Depends(get_db),
                user: models.User = Depends(auth.get_current_user)):
    q = db.query(models.Farm)
    if province:
        q = q.filter(models.Farm.province == province)
    return q.limit(limit).all()


@app.get("/api/regions", response_model=List[schemas.RegionOut])
def list_regions(db: Session = Depends(get_db), user: models.User = Depends(auth.get_current_user)):
    rows = (
        db.query(
            models.Survey.province,
            models.Survey.regency,
            func.count(func.distinct(models.Survey.farm_id)).label("farm_count"),
            func.count(models.Survey.id).label("survey_count"),
        )
        .filter(models.Survey.is_deleted.is_(False))
        .group_by(models.Survey.province, models.Survey.regency)
        .all()
    )
    return [
        schemas.RegionOut(province=p or "Unknown", regency=r, farm_count=fc or 0, survey_count=sc or 0)
        for p, r, fc, sc in rows
    ]


# ---------------------------------------------------------------------------
# Administrator: user management (Step 9)
# ---------------------------------------------------------------------------

@app.post("/api/users", response_model=schemas.UserOut, status_code=status.HTTP_201_CREATED)
def create_user(payload: schemas.UserCreate, db: Session = Depends(get_db),
                 user: models.User = Depends(auth.require_roles("Administrator"))):
    if db.query(models.User).filter(models.User.username == payload.username).first():
        raise HTTPException(status_code=400, detail="Username already exists")
    new_user = models.User(
        username=payload.username, full_name=payload.full_name,
        role=models.UserRole(payload.role), password_hash=auth.hash_password(payload.password),
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    sync_module._write_audit(db, user, "USER_CREATED", "user", new_user.id, None,
                              {"username": payload.username, "role": payload.role})
    db.commit()
    return new_user


@app.get("/api/users", response_model=List[schemas.UserOut])
def list_users(db: Session = Depends(get_db), user: models.User = Depends(auth.require_roles("Administrator"))):
    return db.query(models.User).all()
