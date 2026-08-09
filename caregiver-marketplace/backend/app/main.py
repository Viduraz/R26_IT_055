"""
caregiver-marketplace/backend/app/main.py
FastAPI application for the Caregiver Marketplace service.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes.caregiver_routes import router as caregiver_router
from app.routes.booking_routes import router as booking_router
from app.routes.review_routes import router as review_router
from app.routes.monitor_routes import router as monitor_router

app = FastAPI(
    title="Secure Elder Care — Caregiver Marketplace",
    version="1.0.0",
    description="Browse caregivers, book services, and monitor elders via Patient ID",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(caregiver_router, prefix="/api/marketplace", tags=["Caregivers"])
app.include_router(booking_router, prefix="/api/marketplace", tags=["Bookings"])
app.include_router(review_router, prefix="/api/marketplace", tags=["Reviews"])
app.include_router(monitor_router, prefix="/api/marketplace", tags=["Monitoring"])


@app.get("/health")
def health():
    return {"status": "ok", "service": "caregiver-marketplace"}
