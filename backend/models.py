"""
models.py — SQLAlchemy ORM models = the central PostgreSQL schema (Step 5).

Design notes:
- Every survey gets a client-generated UUID primary key (Step 2/8), so the
  same record can be safely re-uploaded (idempotent sync, Step 8) without
  ever creating a duplicate row.
- created_at/created_by/updated_at/updated_by present wherever the spec
  asks for them (Step 5).
- Raw field data is NEVER overwritten. crop_observations stores what the
  surveyor actually recorded; production_estimates keeps farmer/surveyor/
  model/agronomist-adjusted numbers as separate columns, never overwriting
  one with another (Step 13, 27).
- sync_log records every batch sync attempt (Step 3, 8, 24).
- audit_log records every meaningful change for traceability (Step 26).
- version_number + server_updated_at on surveys support conflict detection
  (Step 25) without silently overwriting newer server data.
"""
import uuid
import enum
from datetime import datetime

from sqlalchemy import (
    Column, String, Float, Integer, Boolean, DateTime, ForeignKey, Text,
    Enum, JSON, UniqueConstraint, Index,
)
from sqlalchemy.orm import relationship

from database import Base


def gen_uuid() -> str:
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class UserRole(str, enum.Enum):
    FIELD_SURVEYOR = "Field Surveyor"
    AGRONOMIST = "Agronomist"
    MANAGER = "Manager"
    ADMINISTRATOR = "Administrator"


class SyncStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    PENDING_SYNC = "PENDING_SYNC"
    SYNCING = "SYNCING"
    SYNCED = "SYNCED"
    SYNC_ERROR = "SYNC_ERROR"


class DataQualityStatus(str, enum.Enum):
    VALID = "VALID"
    WARNING = "WARNING"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"
    REJECTED = "REJECTED"


# ---------------------------------------------------------------------------
# users
# ---------------------------------------------------------------------------

class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    username = Column(String(64), unique=True, nullable=False, index=True)
    full_name = Column(String(128), nullable=False)
    role = Column(Enum(UserRole), nullable=False, default=UserRole.FIELD_SURVEYOR)
    password_hash = Column(String(255), nullable=False)  # never plain text (Step 9)
    is_active = Column(Boolean, default=True, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    surveys = relationship("Survey", back_populates="surveyor", foreign_keys="Survey.surveyor_id")


# ---------------------------------------------------------------------------
# farmers
# ---------------------------------------------------------------------------

class Farmer(Base):
    __tablename__ = "farmers"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    farmer_code = Column(String(64), unique=True, nullable=True, index=True)  # from app's farmerId text field
    full_name = Column(String(128), nullable=False)
    phone_number = Column(String(32), nullable=True)
    note = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    created_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    updated_by = Column(String(36), ForeignKey("users.id"), nullable=True)

    farms = relationship("Farm", back_populates="farmer")
    surveys = relationship("Survey", back_populates="farmer")


# ---------------------------------------------------------------------------
# farms
# ---------------------------------------------------------------------------

class Farm(Base):
    __tablename__ = "farms"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    farmer_id = Column(String(36), ForeignKey("farmers.id"), nullable=False, index=True)

    province = Column(String(100), nullable=True, index=True)
    regency = Column(String(100), nullable=True, index=True)     # a.k.a. district/kabupaten
    district = Column(String(100), nullable=True)                # a.k.a. kecamatan/sub-district
    village = Column(String(100), nullable=True)

    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    gps_accuracy_m = Column(Float, nullable=True)
    # Spatial column placeholder for PostGIS (Step 11), added via a migration
    # once PostGIS is enabled on the target Postgres server:
    #   ALTER TABLE farms ADD COLUMN geom geography(Point, 4326);
    #   UPDATE farms SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326);
    # Left out of the ORM model here to keep SQLite-compatibility for local dev.

    coffee_species = Column(String(32), nullable=True)   # Robusta / Arabica
    coffee_variety = Column(String(64), nullable=True)
    farm_area_ha = Column(Float, nullable=True)
    tree_age_years = Column(Float, nullable=True)
    tree_population = Column(Integer, nullable=True)

    gps_valid = Column(Boolean, nullable=True)
    gps_warning = Column(String(255), nullable=True)
    coordinate_duplicate = Column(Boolean, default=False)
    location_validation_status = Column(String(32), nullable=True)  # e.g. "REGION_MATCH", "OUTSIDE_INDONESIA"

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    created_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    updated_by = Column(String(36), ForeignKey("users.id"), nullable=True)

    farmer = relationship("Farmer", back_populates="farms")
    surveys = relationship("Survey", back_populates="farm")

    __table_args__ = (
        Index("ix_farms_lat_lon", "latitude", "longitude"),
    )


# ---------------------------------------------------------------------------
# surveys  (the central record — client-generated UUID primary key)
# ---------------------------------------------------------------------------

class Survey(Base):
    __tablename__ = "surveys"

    # Client-generated UUID (Step 2). Re-uploading the same survey_id must
    # UPDATE, never INSERT a duplicate row (Step 8) -- enforced in sync.py.
    id = Column(String(36), primary_key=True)  # = survey_id from the device, NOT server-generated

    device_id = Column(String(128), nullable=True)
    surveyor_id = Column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    surveyor_name_snapshot = Column(String(128), nullable=True)  # denormalized for offline-created records

    farmer_id = Column(String(36), ForeignKey("farmers.id"), nullable=True, index=True)
    farm_id = Column(String(36), ForeignKey("farms.id"), nullable=True, index=True)

    sample_no = Column(String(64), nullable=True)
    province = Column(String(100), nullable=True, index=True)
    regency = Column(String(100), nullable=True, index=True)
    district = Column(String(100), nullable=True)
    village = Column(String(100), nullable=True)

    survey_date = Column(String(10), nullable=True)   # YYYY-MM-DD as submitted by device
    survey_time = Column(String(8), nullable=True)    # HH:MM:SS as submitted by device
    crop_year = Column(String(16), nullable=True, index=True)   # e.g. "2026/27"
    survey_round = Column(String(32), nullable=True)

    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    gps_accuracy_m = Column(Float, nullable=True)

    farmer_feedback = Column(Text, nullable=True)
    surveyor_notes = Column(Text, nullable=True)

    # Raw QN.xlsx questionnaire payload kept intact as JSON so no column of
    # the 75-field form is ever lost even before it's normalized into the
    # crop_observations / production_estimates tables below.
    raw_payload = Column(JSON, nullable=True)

    # --- Sync / offline-first bookkeeping (Step 3, 24, 25) ---
    sync_status = Column(Enum(SyncStatus), nullable=False, default=SyncStatus.PENDING_SYNC)
    local_updated_at = Column(DateTime, nullable=True)   # timestamp reported by the device
    server_updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    version_number = Column(Integer, nullable=False, default=1)
    has_conflict = Column(Boolean, default=False, nullable=False)

    # --- Data quality (Step 12) ---
    data_quality_status = Column(Enum(DataQualityStatus), nullable=False, default=DataQualityStatus.VALID)
    data_quality_notes = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    created_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    updated_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    is_deleted = Column(Boolean, default=False, nullable=False)  # soft delete only — never hard-delete (Step 5)

    surveyor = relationship("User", back_populates="surveys", foreign_keys=[surveyor_id])
    farmer = relationship("Farmer", back_populates="surveys")
    farm = relationship("Farm", back_populates="surveys")
    crop_observation = relationship("CropObservation", back_populates="survey", uselist=False)
    production_estimate = relationship("ProductionEstimate", back_populates="survey", uselist=False)
    photos = relationship("Photo", back_populates="survey")

    __table_args__ = (
        Index("ix_surveys_province_crop_year", "province", "crop_year"),
        Index("ix_surveys_sync_status", "sync_status"),
    )


# ---------------------------------------------------------------------------
# crop_observations  (1:1 with survey — raw field observation, never overwritten)
# ---------------------------------------------------------------------------

class CropObservation(Base):
    __tablename__ = "crop_observations"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    survey_id = Column(String(36), ForeignKey("surveys.id"), nullable=False, unique=True, index=True)

    flowering_condition = Column(String(64), nullable=True)
    fruit_stage = Column(String(64), nullable=True)
    fruit_load = Column(String(64), nullable=True)
    cherry_condition = Column(String(64), nullable=True)

    harvest_progress_pct = Column(Float, nullable=True)
    selling_progress_pct = Column(Float, nullable=True)

    pest_condition = Column(String(64), nullable=True)
    disease_condition = Column(String(64), nullable=True)
    rainfall_condition = Column(String(64), nullable=True)
    soil_condition = Column(String(64), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    created_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    updated_by = Column(String(36), ForeignKey("users.id"), nullable=True)

    survey = relationship("Survey", back_populates="crop_observation")


# ---------------------------------------------------------------------------
# production_estimates  (1:1 with survey — raw vs model vs adjusted, Step 13/27)
# ---------------------------------------------------------------------------

class ProductionEstimate(Base):
    __tablename__ = "production_estimates"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    survey_id = Column(String(36), ForeignKey("surveys.id"), nullable=False, unique=True, index=True)

    production_last_year_kg = Column(Float, nullable=True)

    # Never overwrite one estimate with another — each stage kept separately.
    farmer_estimate_kg = Column(Float, nullable=True)          # what the farmer told the surveyor
    surveyor_estimate_kg = Column(Float, nullable=True)        # what the surveyor recorded in the field
    model_estimate_kg = Column(Float, nullable=True)           # Python crop_estimation.py calculation
    agronomist_adjusted_estimate_kg = Column(Float, nullable=True)  # agronomist review/adjustment

    production_next_crop_estimate_kg = Column(Float, nullable=True)

    yield_kg_per_ha = Column(Float, nullable=True)
    change_pct_vs_last_year = Column(Float, nullable=True)

    adjustment_reason = Column(Text, nullable=True)
    adjusted_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    adjusted_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    created_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    updated_by = Column(String(36), ForeignKey("users.id"), nullable=True)

    survey = relationship("Survey", back_populates="production_estimate")


# ---------------------------------------------------------------------------
# photos
# ---------------------------------------------------------------------------

class Photo(Base):
    __tablename__ = "photos"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    survey_id = Column(String(36), ForeignKey("surveys.id"), nullable=False, index=True)

    photo_type = Column(String(32), nullable=True)  # Farm Overview / Coffee Tree / Fruit Load / Pest-Disease / Farmer / Other
    photo_url = Column(String(512), nullable=True)  # object-storage URL or local static path (Step 23)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    captured_at = Column(DateTime, nullable=True)
    uploaded_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    created_by = Column(String(36), ForeignKey("users.id"), nullable=True)

    survey = relationship("Survey", back_populates="photos")


# ---------------------------------------------------------------------------
# sync_log  (Step 3, 8, 28 — one row per batch sync / pipeline run)
# ---------------------------------------------------------------------------

class SyncLog(Base):
    __tablename__ = "sync_log"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    run_id = Column(String(36), nullable=False, default=gen_uuid, index=True)
    device_id = Column(String(128), nullable=True)
    surveyor_id = Column(String(36), ForeignKey("users.id"), nullable=True)

    start_time = Column(DateTime, default=datetime.utcnow, nullable=False)
    end_time = Column(DateTime, nullable=True)

    records_received = Column(Integer, default=0)
    records_created = Column(Integer, default=0)
    records_updated = Column(Integer, default=0)
    records_valid = Column(Integer, default=0)
    records_warning = Column(Integer, default=0)
    records_failed = Column(Integer, default=0)

    processing_status = Column(String(32), default="COMPLETED")  # COMPLETED / FAILED / PARTIAL
    detail = Column(JSON, nullable=True)  # per-record results, see schemas.SyncResultItem


# ---------------------------------------------------------------------------
# audit_log  (Step 26 — traceability for important changes)
# ---------------------------------------------------------------------------

class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(String(36), primary_key=True, default=gen_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    username_snapshot = Column(String(64), nullable=True)

    action = Column(String(64), nullable=False)   # e.g. SURVEY_CREATED, ESTIMATE_ADJUSTED, GPS_CHANGED
    entity_type = Column(String(32), nullable=False)  # survey / farmer / farm / production_estimate / user
    entity_id = Column(String(36), nullable=True, index=True)

    old_value = Column(JSON, nullable=True)
    new_value = Column(JSON, nullable=True)

    occurred_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
