"""
schedule-monitoring/backend/app/main.py
"""
from contextlib import asynccontextmanager
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
    allow_headers=["*"],
)

app.include_router(schedule_router, prefix="/api/schedule", tags=["Schedule Monitoring"])


@app.get("/health")
def health():
    return {"status": "ok", "service": "schedule-monitoring"}
