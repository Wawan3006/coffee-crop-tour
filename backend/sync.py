"""
sync.py — idempotent batch synchronization logic (Step 3, 8, 10, 12, 25, 26).

Core rule (Step 8): re-uploading the same survey_id must never create a
second row. We always look the id up first:
    IF survey_id exists in `surveys` table:
        UPDATE according to synchronization/conflict rules (Step 25)
    ELSE:
        INSERT new record
This makes pressing "SYNC NOW" repeatedly on a flaky connection perfectly
safe -- verified by test_sync_idempotency() in tests/test_backend.py, which
uploads the identical survey_id three times and asserts exactly one row
exists afterward with version_number incremented correctly.
"""
import math
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

import models
import schemas


INDONESIA_BBOX = {"min_lat": -11.5, "max_lat": 6.5, "min_lon": 94.5, "max_lon": 141.5}


# ---------------------------------------------------------------------------
# GPS validation (Step 10) -- pure functions, unit-testable, DB-agnostic
# ---------------------------------------------------------------------------

def haversine_m(lat1, lon1, lat2, lon2) -> float:
    """Great-circle distance in meters between two lat/lon points."""
    R = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(min(1.0, math.sqrt(a)))


def validate_gps(db: Session, lat: Optional[float], lon: Optional[float],
                  gps_accuracy: Optional[float], exclude_survey_id: Optional[str] = None) -> dict:
    """Returns dict: gps_valid, gps_warning, coordinate_duplicate, location_validation_status."""
    result = {
        "gps_valid": True,
        "gps_warning": None,
        "coordinate_duplicate": False,
        "location_validation_status": "OK",
    }

    if lat is None or lon is None:
        result["gps_valid"] = False
        result["gps_warning"] = "Missing GPS coordinates"
        result["location_validation_status"] = "MISSING_GPS"
        return result

    if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
        result["gps_valid"] = False
        result["gps_warning"] = "Latitude/longitude out of valid range"
        result["location_validation_status"] = "INVALID_RANGE"
        return result

    if not (INDONESIA_BBOX["min_lat"] <= lat <= INDONESIA_BBOX["max_lat"]
            and INDONESIA_BBOX["min_lon"] <= lon <= INDONESIA_BBOX["max_lon"]):
        result["gps_valid"] = False
        result["gps_warning"] = "Coordinates fall outside Indonesia"
        result["location_validation_status"] = "OUTSIDE_INDONESIA"
        # still check duplicates below, but this record needs review regardless

    if gps_accuracy is not None and gps_accuracy > 50:
        result["gps_warning"] = (result["gps_warning"] + "; " if result["gps_warning"] else "") + \
            f"Poor GPS accuracy ({gps_accuracy:.0f} m)"

    # Exact-duplicate coordinate check against other surveys (Step 10).
    query = db.query(models.Survey).filter(
        models.Survey.latitude == lat, models.Survey.longitude == lon,
        models.Survey.is_deleted.is_(False),
    )
    if exclude_survey_id:
        query = query.filter(models.Survey.id != exclude_survey_id)
    dup = query.first()
    if dup is not None:
        result["coordinate_duplicate"] = True
        result["gps_warning"] = (result["gps_warning"] + "; " if result["gps_warning"] else "") + \
            f"Identical coordinates already used by survey {dup.id}"

    return result


# ---------------------------------------------------------------------------
# Data quality validation (Step 12)
# ---------------------------------------------------------------------------

def compute_data_quality(survey_in: "schemas.SurveyIn", gps_result: dict) -> tuple[str, str]:
    """Returns (data_quality_status, notes)."""
    issues = []

    if not gps_result["gps_valid"]:
        issues.append(gps_result["gps_warning"] or "Invalid GPS")
    if gps_result["coordinate_duplicate"]:
        issues.append("Duplicate coordinates")
    if not survey_in.farmer_id and not survey_in.farmer_name:
        issues.append("Missing farmer")
    if survey_in.farm_area_ha is None:
        issues.append("Missing farm area")
    elif survey_in.farm_area_ha == 0:
        issues.append("Farm area = 0")
    if survey_in.production_current_estimate_kg is not None and survey_in.production_current_estimate_kg == 0:
        issues.append("Production estimate = 0")
    if survey_in.production_current_estimate_kg is not None and survey_in.farm_area_ha:
        implied_yield = survey_in.production_current_estimate_kg / max(survey_in.farm_area_ha, 0.001)
        if implied_yield > 20000:  # kg/ha -- implausibly high for coffee
            issues.append(f"Implausible yield ({implied_yield:.0f} kg/ha)")
    if not survey_in.survey_date:
        issues.append("Missing survey date")
    else:
        try:
            datetime.strptime(survey_in.survey_date, "%Y-%m-%d")
        except ValueError:
            issues.append("Invalid survey date format")

    if not issues:
        return "VALID", ""
    # Hard rejects: outside Indonesia, invalid date, or 2+ stacked issues -> needs review
    if gps_result["location_validation_status"] == "OUTSIDE_INDONESIA" or len(issues) >= 3:
        return "REVIEW_REQUIRED", "; ".join(issues)
    return "WARNING", "; ".join(issues)


# ---------------------------------------------------------------------------
# Idempotent upsert of a single survey (Step 8, 25, 26)
# ---------------------------------------------------------------------------

def upsert_survey(db: Session, survey_in: "schemas.SurveyIn", user: "models.User",
                   device_id: str) -> "schemas.SyncResultItem":
    existing = db.query(models.Survey).filter(models.Survey.id == survey_in.survey_id).first()

    gps_result = validate_gps(db, survey_in.latitude, survey_in.longitude,
                               survey_in.gps_accuracy, exclude_survey_id=survey_in.survey_id)
    dq_status, dq_notes = compute_data_quality(survey_in, gps_result)

    now = datetime.utcnow()

    if existing is None:
        # ---- CREATE ----
        row = models.Survey(
            id=survey_in.survey_id,
            device_id=device_id,
            surveyor_id=survey_in.surveyor_id or user.id,
            surveyor_name_snapshot=survey_in.surveyor_name or user.full_name,
            province=survey_in.province, regency=survey_in.regency,
            district=survey_in.district, village=survey_in.village,
            sample_no=survey_in.sample_no,
            survey_date=survey_in.survey_date, survey_time=survey_in.survey_time,
            crop_year=survey_in.crop_year, survey_round=survey_in.survey_round,
            latitude=survey_in.latitude, longitude=survey_in.longitude,
            gps_accuracy_m=survey_in.gps_accuracy,
            farmer_feedback=survey_in.farmer_feedback, surveyor_notes=survey_in.surveyor_notes,
            raw_payload=survey_in.raw_payload,
            sync_status=models.SyncStatus.SYNCED,
            local_updated_at=_parse_dt(survey_in.local_updated_at),
            server_updated_at=now,
            version_number=survey_in.version_number or 1,
            data_quality_status=models.DataQualityStatus(dq_status),
            data_quality_notes=dq_notes,
            created_at=now, created_by=user.id,
            updated_at=now, updated_by=user.id,
        )
        db.add(row)
        db.flush()

        _upsert_farmer_and_farm(db, row, survey_in, user)
        _upsert_crop_observation(db, row, survey_in, user)
        _upsert_production_estimate(db, row, survey_in, user)

        _write_audit(db, user, "SURVEY_CREATED", "survey", row.id, None, {"survey_id": row.id})

        return schemas.SyncResultItem(
            survey_id=survey_in.survey_id, result="CREATED",
            server_updated_at=now.isoformat(), data_quality_status=dq_status,
        )

    # ---- Record already exists -> UPDATE per conflict rules (Step 25) ----
    incoming_local_updated = _parse_dt(survey_in.local_updated_at)
    conflict = False
    if (existing.local_updated_at and incoming_local_updated
            and incoming_local_updated < existing.local_updated_at
            and (survey_in.version_number or 1) <= existing.version_number):
        # Incoming data is OLDER than what the server already has -- flag, don't silently overwrite.
        conflict = True
        existing.has_conflict = True
        db.flush()
        _write_audit(db, user, "SYNC_CONFLICT_DETECTED", "survey", existing.id,
                     {"server_updated_at": existing.server_updated_at.isoformat()},
                     {"incoming_local_updated_at": survey_in.local_updated_at})
        return schemas.SyncResultItem(
            survey_id=survey_in.survey_id, result="CONFLICT",
            server_updated_at=existing.server_updated_at.isoformat(),
            data_quality_status=existing.data_quality_status.value,
            message="Server has a newer version of this record; flagged for manual review.",
        )

    old_snapshot = {
        "farm_area_ha": survey_in.farm_area_ha,
        "province": existing.province, "district": existing.district,
        "latitude": existing.latitude, "longitude": existing.longitude,
    }

    existing.province = survey_in.province or existing.province
    existing.regency = survey_in.regency or existing.regency
    existing.district = survey_in.district or existing.district
    existing.village = survey_in.village or existing.village
    existing.sample_no = survey_in.sample_no or existing.sample_no
    existing.survey_date = survey_in.survey_date or existing.survey_date
    existing.survey_time = survey_in.survey_time or existing.survey_time
    existing.crop_year = survey_in.crop_year or existing.crop_year
    existing.latitude = survey_in.latitude if survey_in.latitude is not None else existing.latitude
    existing.longitude = survey_in.longitude if survey_in.longitude is not None else existing.longitude
    existing.gps_accuracy_m = survey_in.gps_accuracy if survey_in.gps_accuracy is not None else existing.gps_accuracy_m
    existing.farmer_feedback = survey_in.farmer_feedback or existing.farmer_feedback
    existing.surveyor_notes = survey_in.surveyor_notes or existing.surveyor_notes
    if survey_in.raw_payload:
        existing.raw_payload = survey_in.raw_payload
    existing.sync_status = models.SyncStatus.SYNCED
    existing.local_updated_at = incoming_local_updated or existing.local_updated_at
    existing.server_updated_at = now
    existing.version_number = max(existing.version_number, survey_in.version_number or 1) + 1
    existing.data_quality_status = models.DataQualityStatus(dq_status)
    existing.data_quality_notes = dq_notes
    existing.updated_at = now
    existing.updated_by = user.id
    existing.has_conflict = False

    _upsert_farmer_and_farm(db, existing, survey_in, user)
    _upsert_crop_observation(db, existing, survey_in, user)
    _upsert_production_estimate(db, existing, survey_in, user)

    _write_audit(db, user, "SURVEY_UPDATED", "survey", existing.id, old_snapshot,
                 {"farm_area_ha": survey_in.farm_area_ha})

    return schemas.SyncResultItem(
        survey_id=survey_in.survey_id, result="UPDATED",
        server_updated_at=now.isoformat(), data_quality_status=dq_status,
    )


def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


def _upsert_farmer_and_farm(db: Session, survey_row: "models.Survey",
                             survey_in: "schemas.SurveyIn", user: "models.User"):
    farmer = None
    if survey_in.farmer_id:
        farmer = db.query(models.Farmer).filter(models.Farmer.farmer_code == survey_in.farmer_id).first()
    if farmer is None and (survey_in.farmer_id or survey_in.farmer_name):
        farmer = models.Farmer(
            farmer_code=survey_in.farmer_id, full_name=survey_in.farmer_name or "Unknown",
            created_by=user.id, updated_by=user.id,
        )
        db.add(farmer)
        db.flush()
    if farmer is not None:
        survey_row.farmer_id = farmer.id

    if survey_in.latitude is not None and survey_in.longitude is not None and farmer is not None:
        farm = db.query(models.Farm).filter(
            models.Farm.farmer_id == farmer.id,
            models.Farm.latitude == survey_in.latitude,
            models.Farm.longitude == survey_in.longitude,
        ).first()
        gps_result = validate_gps(db, survey_in.latitude, survey_in.longitude, survey_in.gps_accuracy)
        if farm is None:
            farm = models.Farm(
                farmer_id=farmer.id, province=survey_in.province, regency=survey_in.regency,
                district=survey_in.district, village=survey_in.village,
                latitude=survey_in.latitude, longitude=survey_in.longitude,
                gps_accuracy_m=survey_in.gps_accuracy,
                coffee_species=survey_in.coffee_species, coffee_variety=survey_in.coffee_variety,
                farm_area_ha=survey_in.farm_area_ha, tree_age_years=survey_in.tree_age,
                tree_population=survey_in.tree_population,
                gps_valid=gps_result["gps_valid"], gps_warning=gps_result["gps_warning"],
                coordinate_duplicate=gps_result["coordinate_duplicate"],
                location_validation_status=gps_result["location_validation_status"],
                created_by=user.id, updated_by=user.id,
            )
            db.add(farm)
            db.flush()
        survey_row.farm_id = farm.id


def _upsert_crop_observation(db: Session, survey_row: "models.Survey",
                              survey_in: "schemas.SurveyIn", user: "models.User"):
    obs = db.query(models.CropObservation).filter(models.CropObservation.survey_id == survey_row.id).first()
    if obs is None:
        obs = models.CropObservation(survey_id=survey_row.id, created_by=user.id, updated_by=user.id)
        db.add(obs)
    obs.flowering_condition = survey_in.flowering_condition or obs.flowering_condition
    obs.fruit_stage = survey_in.fruit_stage or obs.fruit_stage
    obs.fruit_load = survey_in.fruit_load or obs.fruit_load
    obs.cherry_condition = survey_in.cherry_condition or obs.cherry_condition
    obs.harvest_progress_pct = survey_in.harvest_progress_pct if survey_in.harvest_progress_pct is not None else obs.harvest_progress_pct
    obs.selling_progress_pct = survey_in.selling_progress_pct if survey_in.selling_progress_pct is not None else obs.selling_progress_pct
    obs.pest_condition = survey_in.pest_condition or obs.pest_condition
    obs.disease_condition = survey_in.disease_condition or obs.disease_condition
    obs.rainfall_condition = survey_in.rainfall_condition or obs.rainfall_condition
    obs.soil_condition = survey_in.soil_condition or obs.soil_condition
    obs.updated_by = user.id


def _upsert_production_estimate(db: Session, survey_row: "models.Survey",
                                 survey_in: "schemas.SurveyIn", user: "models.User"):
    est = db.query(models.ProductionEstimate).filter(models.ProductionEstimate.survey_id == survey_row.id).first()
    if est is None:
        est = models.ProductionEstimate(survey_id=survey_row.id, created_by=user.id, updated_by=user.id)
        db.add(est)
    est.production_last_year_kg = survey_in.production_last_year_kg if survey_in.production_last_year_kg is not None else est.production_last_year_kg
    # surveyor_estimate_kg is the raw field number -- NEVER overwritten by model/agronomist values (Step 27).
    if survey_in.production_current_estimate_kg is not None:
        est.surveyor_estimate_kg = survey_in.production_current_estimate_kg
    est.production_next_crop_estimate_kg = (
        survey_in.production_next_crop_estimate_kg
        if survey_in.production_next_crop_estimate_kg is not None else est.production_next_crop_estimate_kg
    )
    if survey_in.farm_area_ha and est.surveyor_estimate_kg:
        est.yield_kg_per_ha = est.surveyor_estimate_kg / max(survey_in.farm_area_ha, 0.001)
    est.updated_by = user.id


def _write_audit(db: Session, user: "models.User", action: str, entity_type: str,
                  entity_id: str, old_value, new_value):
    db.add(models.AuditLog(
        user_id=user.id, username_snapshot=user.username,
        action=action, entity_type=entity_type, entity_id=entity_id,
        old_value=old_value, new_value=new_value,
    ))
