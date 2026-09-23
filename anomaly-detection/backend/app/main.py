"""
anomaly-detection/backend/app/main.py
"""
import sys, os
from pathlib import Path
root_dir = Path(__file__).resolve().parents[3]
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes.anomaly_routes import router as anomaly_router

app = FastAPI(
    title="Secure Elder Care — Anomaly Detection Service",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

app.include_router(anomaly_router, prefix="/api/anomaly", tags=["Anomaly Detection"])


@app.get("/health")
def health():
    return {"status": "ok", "service": "anomaly-detection"}
