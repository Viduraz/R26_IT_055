"""
schedule-monitoring/backend/app/main.py
"""
import sys, os
from pathlib import Path
root_dir = Path(__file__).resolve().parents[3]
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

import time
import threading
import os
from datetime import datetime
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes.schedule_routes import router as schedule_router
from app.routes.monitoring_routes import router as monitoring_router
from app.services.monitoring_service import MonitoringService
from shared.backend.config.database import get_db

app = FastAPI(
    title="Secure Elder Care — Schedule Monitoring Service",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    # Wildcard allows Cloudflare tunnel domains and local dev.
    # JWT is in Authorization headers — credentials=False is correct.
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(schedule_router, prefix="/api/schedule", tags=["Schedule"])
app.include_router(monitoring_router, prefix="/api/monitoring", tags=["Monitoring"])


# ── Background sweep thread ────────────────────────────────────────────────
from shared.backend.config.database import get_db


def _get_all_patient_ids() -> list:
    """Return every distinct patient/user ID that has an active schedule."""
    docs = list(get_db()["schedules"].find({}, {"patient_id": 1, "user_id": 1}))
    ids = set()
    for d in docs:
        pid = d.get("patient_id") or d.get("user_id")
        if pid:
            ids.add(pid)
    return list(ids) or ["patient_001"]  # fallback so sweep is never a no-op


def _missed_task_sweep():
    """Runs every 60 s; marks tasks MISSED once their time window closes
    for every patient that currently has an active schedule."""
    svc = MonitoringService()
    while True:
        try:
            total_missed = 0
            for patient_id in _get_all_patient_ids():
                result = svc.evaluate_missed_tasks(patient_id)
                total_missed += result["missed_marked"]
            if total_missed:
                print(f"[sweep] marked {total_missed} task(s) as MISSED")
        except Exception as exc:
            print(f"[sweep] error: {exc}")
        time.sleep(60)


def _seed_demo_data():
    """Populate mock DB with demo data so the UI shows a working schedule and reports
    in the local development environment.
    """
    db = get_db()
    if not hasattr(db, "collections"):
        return

    today = datetime.now().strftime("%Y-%m-%d")
    schedule_col = db["schedules"]
    if not list(schedule_col.find({})):
        schedule_col.insert_one({
            "schedule_id": "demo-schedule-001",
            "user_id": "patient_001",
            "patient_id": "patient_001",
            "date": today,
            "description": "Demo routine",
            "created_at": datetime.now(),
            "updated_at": datetime.now(),
            "activities": [
                {"activity_name": "Breakfast", "start_time": "08:00", "end_time": "08:30"},
                {"activity_name": "Medication", "start_time": "12:00", "end_time": "12:20"},
                {"activity_name": "Walk", "start_time": "18:00", "end_time": "18:30"},
            ],
        })

    logs_col = db["activity_logs"]
    if not list(logs_col.find({})):
        logs_col.insert_one({
            "user_id": "patient_001",
            "patient_id": "patient_001",
            "schedule_id": "demo-schedule-001",
            "activity_name": "Breakfast",
            "status": "done",
            "detected_at": datetime.now().isoformat(),
            "created_at": datetime.now(),
        })
        logs_col.insert_one({
            "user_id": "patient_001",
            "patient_id": "patient_001",
            "schedule_id": "demo-schedule-001",
            "activity_name": "Medication",
            "status": "late",
            "detected_at": datetime.now().isoformat(),
            "created_at": datetime.now(),
        })
        logs_col.insert_one({
            "user_id": "patient_001",
            "patient_id": "patient_001",
            "schedule_id": "demo-schedule-001",
            "activity_name": "Walk",
            "status": "missed",
            "detected_at": datetime.now().isoformat(),
            "created_at": datetime.now(),
        })

    archives = db["daily_archives"]
    if not list(archives.find({})):
        archives.insert_one({
            "report_id": "demo-report-001",
            "user_id": "patient_001",
            "date": today,
            "schedule_id": "demo-schedule-001",
            "activities": [
                {"activity_name": "Breakfast", "status": "done", "detected_at": datetime.now().isoformat()},
                {"activity_name": "Medication", "status": "late", "detected_at": datetime.now().isoformat()},
                {"activity_name": "Walk", "status": "missed", "detected_at": datetime.now().isoformat()},
            ],
            "counts": {
                "done": 1,
                "late": 1,
                "missed": 1,
                "caregiver_missing": 0,
                "pending": 0,
                "total": 3,
            },
            "created_at": datetime.now(),
        })


@app.on_event("startup")
def startup_event():
    if os.getenv("SEED_DEMO_DATA", "false").lower() == "true":
        _seed_demo_data()
    thread = threading.Thread(target=_missed_task_sweep, daemon=True)
    thread.start()
    print("[startup] missed-task sweep thread started")


@app.get("/health")
def health():
    return {"status": "ok", "service": "schedule-monitoring", "version": "2.0.0"}