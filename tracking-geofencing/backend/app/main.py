"""
tracking-geofencing/backend/app/main.py
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes.tracking_routes import router as tracking_router

app = FastAPI(
    title="Secure Elder Care — Tracking & Geofencing Service",
    version="1.0.0",
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

app.include_router(tracking_router, prefix="/api/tracking", tags=["Tracking & Geofencing"])


@app.get("/health")
def health():
    return {"status": "ok", "service": "tracking-geofencing"}
