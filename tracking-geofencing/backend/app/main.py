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
    # Wildcard allows Cloudflare tunnel domains and local dev.
    # JWT is in Authorization headers — credentials=False is correct.
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tracking_router, prefix="/api/tracking", tags=["Tracking & Geofencing"])


@app.get("/health")
def health():
    return {"status": "ok", "service": "tracking-geofencing"}
