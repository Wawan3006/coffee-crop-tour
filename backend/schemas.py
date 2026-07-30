"""
schemas.py — Pydantic request/response models for the FastAPI endpoints (Step 7).
"""
from datetime import datetime
from typing import Optional, List, Any, Dict
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    username: str
    full_name: str
    role: str


class UserOut(BaseModel):
    id: str
    username: str
    full_name: str
    role: str
    is_active: bool

    class Config:
        from_attributes = True


class UserCreate(BaseModel):
    username: str
    full_name: str
    role: str
    password: str


# ---------------------------------------------------------------------------
# Survey (single-record CRUD, Step 7)
# ---------------------------------------------------------------------------

class SurveyIn(BaseModel):
    """One survey record as sent by the device. Mirrors the field list from
    the task spec (Step 2), plus the QN.xlsx raw payload as a flexible dict
    so no questionnaire field is ever dropped even before full normalization."""

    survey_id: str = Field(..., description="Client-generated UUID")
    device_id: Optional[str] = None
    surveyor_id: Optional[str] = None
    surveyor_name: Optional[str] = None

    province: Optional[str] = None
    regency: Optional[str] = None
    district: Optional[str] = None
    village: Optional[str] = None

    farmer_id: Optional[str] = None
    farmer_name: Optional[str] = None

    latitude: Optional[float] = None
    longitude: Optional[float] = None
    gps_accuracy: Optional[float] = None

    farm_area_ha: Optional[float] = None
    coffee_species: Optional[str] = None
    coffee_variety: Optional[str] = None
    tree_age: Optional[float] = None
    tree_population: Optional[int] = None

    flowering_condition: Optional[str] = None
    fruit_stage: Optional[str] = None
    fruit_load: Optional[str] = None
    cherry_condition: Optional[str] = None

    harvest_progress_pct: Optional[float] = None
    selling_progress_pct: Optional[float] = None

    production_last_year_kg: Optional[float] = None
    production_current_estimate_kg: Optional[float] = None
    production_next_crop_estimate_kg: Optional[float] = None

    pest_condition: Optional[str] = None
    disease_condition: Optional[str] = None
    rainfall_condition: Optional[str] = None
    soil_condition: Optional[str] = None

    farmer_feedback: Optional[str] = None
    surveyor_notes: Optional[str] = None

    survey_date: Optional[str] = None
    survey_time: Optional[str] = None
    crop_year: Optional[str] = None
    survey_round: Optional[str] = None
    sample_no: Optional[str] = None

    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    local_updated_at: Optional[str] = None
    version_number: Optional[int] = 1

    # Full raw QN.xlsx field set (all 75 columns) — stored as-is in JSON so
    # nothing is lost, in addition to the normalized columns above.
    raw_payload: Optional[Dict[str, Any]] = None


class SurveyOut(BaseModel):
    id: str
    sync_status: str
    data_quality_status: str
    province: Optional[str]
    regency: Optional[str]
    district: Optional[str]
    farmer_id: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]
    survey_date: Optional[str]
    crop_year: Optional[str]
    version_number: int
    server_updated_at: datetime
    has_conflict: bool

    class Config:
        from_attributes = True


class SurveyUpdate(BaseModel):
    """Partial update, e.g. an agronomist adjusting an estimate or fixing GPS."""
    farm_area_ha: Optional[float] = None
    production_current_estimate_kg: Optional[float] = None
    agronomist_adjusted_estimate_kg: Optional[float] = None
    adjustment_reason: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    data_quality_status: Optional[str] = None
    version_number: Optional[int] = None  # required for optimistic-lock conflict check


# ---------------------------------------------------------------------------
# Sync (batch upload, Step 7/8)
# ---------------------------------------------------------------------------

class SyncRequest(BaseModel):
    device_id: str
    surveyor_id: Optional[str] = None
    surveys: List[SurveyIn]


class SyncResultItem(BaseModel):
    survey_id: str
    result: str          # CREATED | UPDATED | CONFLICT | ERROR | SKIPPED_NO_CHANGE
    server_updated_at: Optional[str] = None
    data_quality_status: Optional[str] = None
    message: Optional[str] = None


class SyncResponse(BaseModel):
    run_id: str
    device_id: str
    records_received: int
    records_created: int
    records_updated: int
    records_failed: int
    results: List[SyncResultItem]


# ---------------------------------------------------------------------------
# Photos (Step 23)
# ---------------------------------------------------------------------------

class PhotoOut(BaseModel):
    id: str
    survey_id: str
    photo_type: Optional[str]
    photo_url: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]
    captured_at: Optional[datetime]

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Farmers / Farms / Regions (Step 7)
# ---------------------------------------------------------------------------

class FarmerOut(BaseModel):
    id: str
    farmer_code: Optional[str]
    full_name: str
    phone_number: Optional[str]

    class Config:
        from_attributes = True


class FarmOut(BaseModel):
    id: str
    farmer_id: str
    province: Optional[str]
    regency: Optional[str]
    district: Optional[str]
    village: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]
    coffee_species: Optional[str]
    farm_area_ha: Optional[float]

    class Config:
        from_attributes = True


class RegionOut(BaseModel):
    province: str
    regency: Optional[str] = None
    farm_count: int
    survey_count: int
