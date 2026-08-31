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
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes.schedule_routes import router as schedule_router
from app.routes.monitoring_routes import router as monitoring_router
from app.services.monitoring_service import MonitoringService

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


@app.on_event("startup")
def startup_event():
    thread = threading.Thread(target=_missed_task_sweep, daemon=True)
    thread.start()
    print("[startup] missed-task sweep thread started")


@app.get("/health")
def health():
    return {"status": "ok", "service": "schedule-monitoring", "version": "2.0.0"}