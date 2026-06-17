"""
schedule-monitoring/backend/app/main.py
"""

from contextlib import asynccontextmanager

import time
import threading

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.background import BackgroundScheduler
from app.routes.schedule_routes import router as schedule_router

from app.services.schedule_service import ScheduleService

scheduler = BackgroundScheduler()

@asynccontextmanager
async def lifespan(app: FastAPI):
    service = ScheduleService()
    # Start background scheduler for checking missed activities (TEST MODE: 1 min)
    scheduler.add_job(service.check_missed_activities, 'interval', minutes=1)
    scheduler.start()
    yield
    scheduler.shutdown()

app = FastAPI(
    title="Secure Elder Care — Schedule Monitoring Service",
    version="1.0.0",
    lifespan=lifespan,

from app.routes.monitoring_routes import router as monitoring_router

app = FastAPI(
    title="Secure Elder Care — Schedule Monitoring Service",
    version="2.0.0",

)

app.add_middleware(
    CORSMiddleware,

    allow_origins=[
        "http://localhost:5173", 
        "http://localhost:5174", 
        "http://localhost:5177", 
        "http://localhost:5178", 
        "http://localhost:3000"
    ],
    allow_origin_regex=r"https?://localhost:\d+",
    allow_credentials=True,
    allow_methods=["*"], 

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
def _missed_task_sweep():
    """Runs every 60 s; marks tasks MISSED once their time window closes."""
    from app.services.monitoring_service import MonitoringService
    svc = MonitoringService()
    while True:
        try:
            result = svc.evaluate_missed_tasks("patient_001")
            if result["missed_marked"]:
                print(f"[sweep] marked {result['missed_marked']} task(s) as MISSED")
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
