"""
clean_data.py -- Python data validation pipeline (Step 12).

Runs the same completeness/plausibility checks the sync API applies at
upload time, but as a batch pass over the whole `surveys` table, so records
edited later (or bulk-imported) also get re-classified.

Checks (per spec):
  Missing GPS, Missing farmer, Missing farm area, Farm area = 0,
  Production estimate = 0, Impossible production, Duplicate survey,
  Duplicate farmer, Invalid survey date, Missing crop observations,
  Missing required photographs.

Sets: data_quality_status in {VALID, WARNING, REVIEW_REQUIRED, REJECTED}

Usage:  python3 analytics/clean_data.py
"""
import os
import sys
from datetime import datetime
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from db_connect import get_session  # noqa: E402
import models  # noqa: E402


def classify(session, survey: "models.Survey") -> tuple[str, list]:
    issues = []

    if survey.latitude is None or survey.longitude is None:
        issues.append("Missing GPS")
    if not survey.farmer_id:
        issues.append("Missing farmer")

    farm = session.query(models.Farm).filter(models.Farm.id == survey.farm_id).first() if survey.farm_id else None
    if not farm or farm.farm_area_ha is None:
        issues.append("Missing farm area")
    elif farm.farm_area_ha == 0:
        issues.append("Farm area = 0")

    est = session.query(models.ProductionEstimate).filter(models.ProductionEstimate.survey_id == survey.id).first()
    if not est or (est.surveyor_estimate_kg is None):
        issues.append("Production estimate missing")
    elif est.surveyor_estimate_kg == 0:
        issues.append("Production estimate = 0")
    elif farm and farm.farm_area_ha and est.surveyor_estimate_kg / max(farm.farm_area_ha, 0.001) > 20000:
        issues.append("Impossible production (>20,000 kg/ha)")

    if not survey.survey_date:
        issues.append("Missing survey date")
    else:
        try:
            datetime.strptime(survey.survey_date, "%Y-%m-%d")
        except ValueError:
            issues.append("Invalid survey date")

    obs = session.query(models.CropObservation).filter(models.CropObservation.survey_id == survey.id).first()
    if not obs:
        issues.append("Missing crop observations")

    photo_count = session.query(models.Photo).filter(models.Photo.survey_id == survey.id).count()
    if photo_count == 0:
        issues.append("Missing required photographs")

    # duplicate survey_id can't happen (primary key), but duplicate farmer+date+farm combos can:
    if survey.farmer_id and survey.survey_date:
        dup_count = session.query(models.Survey).filter(
            models.Survey.farmer_id == survey.farmer_id,
            models.Survey.survey_date == survey.survey_date,
            models.Survey.id != survey.id,
            models.Survey.is_deleted.is_(False),
        ).count()
        if dup_count > 0:
            issues.append("Duplicate survey (same farmer + date)")

    if not issues:
        return "VALID", issues
    if any(i in ("Missing GPS", "Invalid survey date", "Impossible production (>20,000 kg/ha)") for i in issues) or len(issues) >= 4:
        return "REJECTED" if len(issues) >= 5 else "REVIEW_REQUIRED", issues
    return "WARNING", issues


def run():
    session = get_session()
    surveys = session.query(models.Survey).filter(models.Survey.is_deleted.is_(False)).all()

    tally = Counter()
    for s in surveys:
        status, issues = classify(session, s)
        s.data_quality_status = models.DataQualityStatus(status)
        s.data_quality_notes = "; ".join(issues)
        tally[status] += 1

    session.commit()
    print(f"Data quality pass complete: {len(surveys)} surveys classified.")
    for status, count in tally.items():
        print(f"  {status}: {count}")
    return dict(tally)


if __name__ == "__main__":
    run()
