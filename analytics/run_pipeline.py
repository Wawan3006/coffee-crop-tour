"""
run_pipeline.py -- scheduled Python processing pipeline (Step 28).

Chains: Database -> Validation -> GPS Validation -> Production Calculation
        -> Regional Aggregation -> Power BI Reporting Tables

Logs run_id, start_time, end_time, records_processed, records_valid,
records_warning, records_failed, processing_status into the same
`sync_log` table the backend API writes to, so all pipeline activity
(manual syncs AND scheduled batch runs) is visible in one place.

Usage:  python3 analytics/run_pipeline.py
Schedule this with cron / Task Scheduler / a CI job for the "scheduled
refresh" described in Step 29 (e.g. nightly, or before each Power BI
scheduled refresh window).
"""
import os
import sys
import uuid
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from db_connect import get_session  # noqa: E402
import models  # noqa: E402

import clean_data
import validate_gps
import crop_estimation
import regional_summary
import export_powerbi


def run():
    run_id = str(uuid.uuid4())
    start_time = datetime.utcnow()
    print(f"=== Pipeline run {run_id} started at {start_time.isoformat()} ===\n")

    print("--- Stage 1: Data validation (clean_data.py) ---")
    quality_tally = clean_data.run()

    print("\n--- Stage 2: GPS validation (validate_gps.py) ---")
    gps_result = validate_gps.run()

    print("\n--- Stage 3: Production calculation (crop_estimation.py) ---")
    estimation_result = crop_estimation.run()

    print("\n--- Stage 4: Regional aggregation (regional_summary.py) ---")
    regional_result = regional_summary.run()

    print("\n--- Stage 5: Power BI reporting tables (export_powerbi.py) ---")
    export_result = export_powerbi.run()

    end_time = datetime.utcnow()

    records_processed = sum(quality_tally.values()) if quality_tally else 0
    records_valid = quality_tally.get("VALID", 0)
    records_warning = quality_tally.get("WARNING", 0) + quality_tally.get("REVIEW_REQUIRED", 0)
    records_failed = quality_tally.get("REJECTED", 0)

    session = get_session()
    session.add(models.SyncLog(
        run_id=run_id, device_id="PIPELINE", start_time=start_time, end_time=end_time,
        records_received=records_processed, records_created=0, records_updated=records_processed,
        records_valid=records_valid, records_warning=records_warning, records_failed=records_failed,
        processing_status="COMPLETED",
        detail={
            "gps_validation": gps_result,
            "crop_estimation": estimation_result,
            "csv_files_written": len(export_result["csv_files"]),
            "sql_views_created": len(export_result["views_created"]),
        },
    ))
    session.commit()

    print(f"\n=== Pipeline run {run_id} completed at {end_time.isoformat()} ===")
    print(f"    records_processed={records_processed} valid={records_valid} warning={records_warning} failed={records_failed}")
    return run_id


if __name__ == "__main__":
    run()
