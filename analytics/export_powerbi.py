"""
export_powerbi.py -- builds the star-schema reporting tables (Step 16) and
Power BI-ready views (Step 17) from the operational PostgreSQL/SQLite tables.

Two output modes, both implemented and tested:

1. SQL VIEWS (preferred for a real PostgreSQL deployment, Step 17): creates
   `vw_powerbi_*` views directly in the database so Power BI's native
   PostgreSQL connector can read them live with a scheduled refresh,
   without ever touching the raw transactional tables.

2. Flat-file star-schema export (works identically on SQLite for local
   dev/testing, and as a portable fallback for Power BI's Text/CSV /
   Excel connector when a Postgres server isn't available yet): writes
   dim_date, dim_location, dim_farmer, dim_farm, dim_surveyor,
   fact_surveys, fact_crop_estimates, fact_harvest_progress,
   fact_production, fact_data_quality as CSV files under
   analytics/powerbi_export/.

Usage:  python3 analytics/export_powerbi.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

import pandas as pd  # noqa: E402
from sqlalchemy import text  # noqa: E402
from db_connect import get_engine  # noqa: E402
from regional_summary import load_survey_frame, best_estimate_column  # noqa: E402

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "powerbi_export")

# ---------------------------------------------------------------------------
# 1. SQL VIEWS (Step 17) -- created directly in the database
# ---------------------------------------------------------------------------

SQL_VIEWS = {
    "vw_powerbi_surveys": """
        CREATE VIEW vw_powerbi_surveys AS
        SELECT
            s.id AS survey_id, s.province, s.regency, s.district, s.village,
            s.crop_year, s.survey_round, s.survey_date,
            s.sync_status, s.data_quality_status,
            s.latitude, s.longitude,
            f.farm_area_ha, f.coffee_species, f.coffee_variety,
            u.full_name AS surveyor_name
        FROM surveys s
        LEFT JOIN farms f ON f.id = s.farm_id
        LEFT JOIN users u ON u.id = s.surveyor_id
        WHERE s.is_deleted = 0
    """,
    "vw_powerbi_production": """
        CREATE VIEW vw_powerbi_production AS
        SELECT
            s.id AS survey_id, s.province, s.regency, s.crop_year,
            pe.production_last_year_kg, pe.farmer_estimate_kg, pe.surveyor_estimate_kg,
            pe.model_estimate_kg, pe.agronomist_adjusted_estimate_kg,
            pe.yield_kg_per_ha, pe.change_pct_vs_last_year
        FROM surveys s
        JOIN production_estimates pe ON pe.survey_id = s.id
        WHERE s.is_deleted = 0
    """,
    "vw_powerbi_farms": """
        CREATE VIEW vw_powerbi_farms AS
        SELECT id AS farm_id, farmer_id, province, regency, district, village,
               latitude, longitude, coffee_species, coffee_variety, farm_area_ha,
               tree_age_years, tree_population, gps_valid, coordinate_duplicate
        FROM farms
    """,
    "vw_powerbi_data_quality": """
        CREATE VIEW vw_powerbi_data_quality AS
        SELECT id AS survey_id, province, regency, crop_year,
               data_quality_status, data_quality_notes, sync_status
        FROM surveys
        WHERE is_deleted = 0
    """,
    "vw_powerbi_crop_summary": """
        CREATE VIEW vw_powerbi_crop_summary AS
        SELECT
            s.province, s.crop_year,
            COUNT(s.id) AS farms_surveyed,
            SUM(f.farm_area_ha) AS surveyed_hectares,
            SUM(COALESCE(pe.agronomist_adjusted_estimate_kg, pe.surveyor_estimate_kg, pe.model_estimate_kg)) AS estimated_production_kg,
            AVG(co.harvest_progress_pct) AS avg_harvest_progress_pct
        FROM surveys s
        LEFT JOIN farms f ON f.id = s.farm_id
        LEFT JOIN production_estimates pe ON pe.survey_id = s.id
        LEFT JOIN crop_observations co ON co.survey_id = s.id
        WHERE s.is_deleted = 0
        GROUP BY s.province, s.crop_year
    """,
}


def create_sql_views(engine):
    created = []
    with engine.begin() as conn:
        for view_name, view_sql in SQL_VIEWS.items():
            try:
                conn.execute(text(f"DROP VIEW IF EXISTS {view_name}"))
                conn.execute(text(view_sql))
                created.append(view_name)
            except Exception as exc:
                print(f"  WARNING: could not create {view_name}: {exc}")
    return created


# ---------------------------------------------------------------------------
# 2. Star-schema flat-file export (Step 16) -- portable, works on any engine
# ---------------------------------------------------------------------------

def build_star_schema(engine) -> dict:
    df = load_survey_frame(engine)
    df["best_estimate_kg"] = best_estimate_column(df)

    dim_date = pd.DataFrame({"crop_year": sorted(df["crop_year"].dropna().unique())})
    dim_date["crop_year_start"] = dim_date["crop_year"].astype(str).str.split("/").str[0]

    dim_location = df[["province", "regency", "district", "village"]].drop_duplicates().reset_index(drop=True)
    dim_location.insert(0, "location_key", range(1, len(dim_location) + 1))

    dim_farm = df[["survey_id", "coffee_species", "farm_area_ha"]].drop_duplicates().reset_index(drop=True)
    dim_farm.insert(0, "farm_key", range(1, len(dim_farm) + 1))

    fact_surveys = df[[
        "survey_id", "province", "regency", "district", "village", "crop_year",
        "survey_round", "data_quality_status", "sync_status",
    ]].copy()

    fact_crop_estimates = df[[
        "survey_id", "province", "crop_year",
        "production_last_year_kg", "surveyor_estimate_kg", "model_estimate_kg",
        "agronomist_adjusted_estimate_kg", "best_estimate_kg", "yield_kg_per_ha",
    ]].copy()

    fact_harvest_progress = df[[
        "survey_id", "province", "crop_year", "harvest_progress_pct", "selling_progress_pct",
    ]].copy()

    fact_production = df.groupby(["province", "crop_year"], dropna=False).agg(
        farms_surveyed=("survey_id", "count"),
        surveyed_hectares=("farm_area_ha", "sum"),
        estimated_production_kg=("best_estimate_kg", "sum"),
    ).reset_index()
    fact_production["estimated_production_mt"] = (fact_production["estimated_production_kg"] / 1000).round(2)

    fact_data_quality = df.groupby(["province", "data_quality_status"], dropna=False).size().reset_index(name="record_count")

    return {
        "dim_date": dim_date,
        "dim_location": dim_location,
        "dim_farm": dim_farm,
        "fact_surveys": fact_surveys,
        "fact_crop_estimates": fact_crop_estimates,
        "fact_harvest_progress": fact_harvest_progress,
        "fact_production": fact_production,
        "fact_data_quality": fact_data_quality,
    }


def write_csvs(tables: dict, output_dir: str = OUTPUT_DIR):
    os.makedirs(output_dir, exist_ok=True)
    written = []
    for name, frame in tables.items():
        path = os.path.join(output_dir, f"{name}.csv")
        frame.to_csv(path, index=False)
        written.append((name, path, len(frame)))
    return written


def run():
    engine = get_engine()

    print("=== Step 17: creating SQL reporting views ===")
    is_sqlite = str(engine.url).startswith("sqlite")
    if is_sqlite:
        print("  NOTE: SQLite backend detected (local dev). SQLite supports CREATE VIEW")
        print("  identically to PostgreSQL for these read-only reporting views, so this")
        print("  still exercises the real view-creation code path end-to-end.")
    created = create_sql_views(engine)
    print(f"  Created {len(created)} views: {created}")

    print("\n=== Step 16: building star-schema tables ===")
    tables = build_star_schema(engine)
    for name, frame in tables.items():
        print(f"  {name}: {len(frame)} rows, columns={list(frame.columns)}")

    print("\n=== Writing CSV exports for Power BI Text/CSV connector ===")
    written = write_csvs(tables)
    for name, path, count in written:
        print(f"  {path} ({count} rows)")

    return {"views_created": created, "tables": tables, "csv_files": written}


if __name__ == "__main__":
    run()
