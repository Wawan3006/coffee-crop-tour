"""
crop_estimation.py -- standardized crop-production calculations (Step 13, 27).

Golden rule (Step 27): NEVER overwrite an original field observation.
farmer_estimate_kg / surveyor_estimate_kg are raw inputs and are left
untouched here. This script only ever writes to model_estimate_kg (and
yield_kg_per_ha), leaving agronomist_adjusted_estimate_kg for a human
reviewer to set separately via PUT /api/surveys/{id}.

Baseline model (kept intentionally simple, matching the spec's example):
    model_estimate_kg = farm_area_ha * expected_yield_kg_per_ha

expected_yield_kg_per_ha defaults to a species-based baseline yield, but
uses the farm's own historical production_last_year_kg / farm_area_ha when
available, since a farm's own history is a better predictor than a national
average. This keeps the methodology simple today while leaving room to
plug in a more sophisticated model later (tree population, branches/tree,
nodes/branch, cherries/node, fruit load, cherry-to-green conversion) using
the same "read raw fields -> write model_estimate_kg" pattern.

Usage:  python3 analytics/crop_estimation.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from db_connect import get_session  # noqa: E402
import models  # noqa: E402

BASELINE_YIELD_KG_PER_HA = {
    "Robusta": 900.0,
    "Arabica": 700.0,
}
DEFAULT_BASELINE_YIELD = 800.0


def estimate_for_survey(session, survey: "models.Survey", est: "models.ProductionEstimate",
                         farm: "models.Farm") -> float:
    farm_area = farm.farm_area_ha if farm else None
    if not farm_area or farm_area <= 0:
        return None

    if est.production_last_year_kg and est.production_last_year_kg > 0:
        historical_yield = est.production_last_year_kg / farm_area
        expected_yield = historical_yield
    else:
        species = farm.coffee_species if farm else None
        expected_yield = BASELINE_YIELD_KG_PER_HA.get(species, DEFAULT_BASELINE_YIELD)

    return round(farm_area * expected_yield, 1)


def run():
    session = get_session()
    surveys = session.query(models.Survey).filter(models.Survey.is_deleted.is_(False)).all()

    computed = 0
    for s in surveys:
        est = session.query(models.ProductionEstimate).filter(models.ProductionEstimate.survey_id == s.id).first()
        farm = session.query(models.Farm).filter(models.Farm.id == s.farm_id).first() if s.farm_id else None
        if est is None:
            continue
        model_value = estimate_for_survey(session, s, est, farm)
        if model_value is not None:
            est.model_estimate_kg = model_value
            if farm and farm.farm_area_ha:
                est.yield_kg_per_ha = round(model_value / farm.farm_area_ha, 1)
            if est.production_last_year_kg and est.production_last_year_kg > 0:
                best_estimate = est.agronomist_adjusted_estimate_kg or est.surveyor_estimate_kg or model_value
                est.change_pct_vs_last_year = round(
                    (best_estimate / est.production_last_year_kg - 1) * 100, 1
                )
            computed += 1

    session.commit()
    print(f"Crop estimation pass complete: {computed} production_estimates rows updated with model_estimate_kg.")
    return {"computed": computed}


if __name__ == "__main__":
    run()
