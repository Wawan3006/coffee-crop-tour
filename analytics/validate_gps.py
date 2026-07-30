"""
validate_gps.py -- standalone Python GPS validation pass (Step 10, 12).

Re-runs GPS validation over ALL surveys currently in the database (not just
newly-synced ones), so it can catch issues introduced by later edits, and
can be scheduled independently of the sync API. Reuses the exact same
validate_gps() logic that backend/sync.py uses at upload time, imported
directly from the backend package so there is only one source of truth for
the validation rules.

Usage:  python3 analytics/validate_gps.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from db_connect import get_session  # noqa: E402
import models  # noqa: E402
from sync import validate_gps  # noqa: E402


def run():
    session = get_session()
    surveys = session.query(models.Survey).filter(models.Survey.is_deleted.is_(False)).all()

    updated = 0
    flagged = 0
    for s in surveys:
        result = validate_gps(session, s.latitude, s.longitude, s.gps_accuracy_m, exclude_survey_id=s.id)
        # Persist findings onto the linked farm row if one exists (Step 10 fields live on `farms`).
        if s.farm_id:
            farm = session.query(models.Farm).filter(models.Farm.id == s.farm_id).first()
            if farm:
                farm.gps_valid = result["gps_valid"]
                farm.gps_warning = result["gps_warning"]
                farm.coordinate_duplicate = result["coordinate_duplicate"]
                farm.location_validation_status = result["location_validation_status"]
                updated += 1
        if not result["gps_valid"] or result["coordinate_duplicate"]:
            flagged += 1

    session.commit()
    print(f"GPS validation pass complete: {len(surveys)} surveys checked, {updated} farm records updated, {flagged} flagged.")
    return {"checked": len(surveys), "updated": updated, "flagged": flagged}


if __name__ == "__main__":
    run()
