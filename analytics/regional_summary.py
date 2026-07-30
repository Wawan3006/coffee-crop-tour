"""
regional_summary.py -- regional aggregation (Step 14) and crop-year
comparison (Step 15).

Aggregates by Province / Regency / District / Village x Crop Year x Survey
Round, computing:
    farms surveyed, surveyed hectares, average yield, estimated production,
    harvest progress, selling progress, fruit-load index, pest/disease
    incidence, survey completion.

Also produces the year-over-year comparison table described in Step 15
(Current vs Previous crop estimate, Difference MT, Difference %).

This module is intentionally pandas-based (not raw SQL aggregation) so the
same DataFrame can be reused directly by export_powerbi.py (Step 16/17) and
is trivially unit-testable without a live DB (see the __main__ block, which
prints results whether the source is SQLite dev DB or Postgres).

Usage:  python3 analytics/regional_summary.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

import pandas as pd  # noqa: E402
from db_connect import get_engine  # noqa: E402


def load_survey_frame(engine) -> pd.DataFrame:
    """One denormalized row per survey, joined with farm/estimate/observation
    data -- the base table every other aggregation in this file builds on."""
    query = """
        SELECT
            s.id AS survey_id, s.province, s.regency, s.district, s.village,
            s.crop_year, s.survey_round, s.data_quality_status, s.sync_status,
            f.farm_area_ha, f.coffee_species,
            pe.production_last_year_kg, pe.surveyor_estimate_kg, pe.model_estimate_kg,
            pe.agronomist_adjusted_estimate_kg, pe.yield_kg_per_ha,
            co.harvest_progress_pct, co.selling_progress_pct,
            co.pest_condition, co.disease_condition, co.fruit_load
        FROM surveys s
        LEFT JOIN farms f ON f.id = s.farm_id
        LEFT JOIN production_estimates pe ON pe.survey_id = s.id
        LEFT JOIN crop_observations co ON co.survey_id = s.id
        WHERE s.is_deleted = 0
    """
    return pd.read_sql(query, engine)


def best_estimate_column(df: pd.DataFrame) -> pd.Series:
    """Priority: agronomist-adjusted > surveyor field estimate > model estimate.
    Never averages these together -- picks the single most authoritative
    number per row, consistent with Step 27's raw-vs-adjusted separation."""
    return (
        df["agronomist_adjusted_estimate_kg"]
        .astype("float64")
        .fillna(df["surveyor_estimate_kg"].astype("float64"))
        .fillna(df["model_estimate_kg"].astype("float64"))
    )


def aggregate_by(df: pd.DataFrame, group_cols: list) -> pd.DataFrame:
    df = df.copy()
    df["best_estimate_kg"] = best_estimate_column(df)
    df["pest_flag"] = df["pest_condition"].notna() & ~df["pest_condition"].isin(["None", "none", ""])
    df["disease_flag"] = df["disease_condition"].notna() & ~df["disease_condition"].isin(["None", "none", ""])

    grouped = df.groupby(group_cols, dropna=False).agg(
        farms_surveyed=("survey_id", "count"),
        surveyed_hectares=("farm_area_ha", "sum"),
        avg_yield_kg_ha=("yield_kg_per_ha", "mean"),
        estimated_production_kg=("best_estimate_kg", "sum"),
        avg_harvest_progress_pct=("harvest_progress_pct", "mean"),
        avg_selling_progress_pct=("selling_progress_pct", "mean"),
        pest_incidence_count=("pest_flag", "sum"),
        disease_incidence_count=("disease_flag", "sum"),
        valid_count=("data_quality_status", lambda s: (s == "VALID").sum()),
    ).reset_index()

    grouped["survey_completion_pct"] = (
        grouped["valid_count"] / grouped["farms_surveyed"].replace(0, pd.NA) * 100
    ).round(1)
    grouped["pest_incidence_pct"] = (
        grouped["pest_incidence_count"] / grouped["farms_surveyed"].replace(0, pd.NA) * 100
    ).round(1)
    grouped["disease_incidence_pct"] = (
        grouped["disease_incidence_count"] / grouped["farms_surveyed"].replace(0, pd.NA) * 100
    ).round(1)
    grouped["estimated_production_mt"] = (grouped["estimated_production_kg"] / 1000).round(2)
    grouped["surveyed_hectares"] = grouped["surveyed_hectares"].round(2)
    grouped["avg_yield_kg_ha"] = grouped["avg_yield_kg_ha"].round(1)

    return grouped


def crop_year_comparison(df: pd.DataFrame, group_cols: list) -> pd.DataFrame:
    """Step 15: current vs previous crop-year estimate, Difference MT / %."""
    df = df.copy()
    df["best_estimate_kg"] = best_estimate_column(df)

    by_year = df.groupby(group_cols + ["crop_year"], dropna=False)["best_estimate_kg"].sum().reset_index()
    by_year = by_year.sort_values(group_cols + ["crop_year"])

    rows = []
    for keys, sub in by_year.groupby(group_cols, dropna=False):
        sub = sub.sort_values("crop_year").reset_index(drop=True)
        for i in range(1, len(sub)):
            prev_mt = sub.loc[i - 1, "best_estimate_kg"] / 1000
            curr_mt = sub.loc[i, "best_estimate_kg"] / 1000
            diff_mt = curr_mt - prev_mt
            diff_pct = (diff_mt / prev_mt * 100) if prev_mt else None
            key_dict = dict(zip(group_cols, keys if isinstance(keys, tuple) else (keys,)))
            rows.append({
                **key_dict,
                "previous_crop_year": sub.loc[i - 1, "crop_year"],
                "current_crop_year": sub.loc[i, "crop_year"],
                "previous_estimate_mt": round(prev_mt, 2),
                "current_estimate_mt": round(curr_mt, 2),
                "difference_mt": round(diff_mt, 2),
                "difference_pct": round(diff_pct, 1) if diff_pct is not None else None,
            })
    return pd.DataFrame(rows)


def run():
    engine = get_engine()
    df = load_survey_frame(engine)
    print(f"Loaded {len(df)} survey rows from database.")

    national = aggregate_by(df, ["crop_year"])
    print("\n=== National Aggregation by Crop Year ===")
    print(national.to_string(index=False))

    by_province = aggregate_by(df, ["province", "crop_year"])
    print("\n=== By Province x Crop Year ===")
    print(by_province.to_string(index=False))

    comparison = crop_year_comparison(df, ["province"])
    print("\n=== Crop Year Comparison by Province (Step 15) ===")
    print(comparison.to_string(index=False) if not comparison.empty else "(not enough crop-year history yet)")

    return {"national": national, "by_province": by_province, "comparison": comparison}


if __name__ == "__main__":
    run()
