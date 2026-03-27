"""
schedule-monitoring/backend/app/main.py
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes.schedule_routes import router as schedule_router

app = FastAPI(
    title="Secure Elder Care — Schedule Monitoring Service",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

app.include_router(schedule_router, prefix="/api/schedule", tags=["Schedule Monitoring"])


@app.get("/health")
def health():
    return {"status": "ok", "service": "schedule-monitoring"}
