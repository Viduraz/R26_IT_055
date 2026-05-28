"""
schedule-monitoring/backend/app/main.py
"""
import time
import threading
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes.schedule_routes import router as schedule_router
from app.routes.monitoring_routes import router as monitoring_router

app = FastAPI(
    title="Secure Elder Care — Schedule Monitoring Service",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", # Auth
        "http://localhost:5174", # Face
        "http://localhost:5175", # Tracking
        "http://localhost:5176", # Anomaly
        "http://localhost:5177", # Schedule
        "http://localhost:5178", # Gateway
    ],
    allow_credentials=True,
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
