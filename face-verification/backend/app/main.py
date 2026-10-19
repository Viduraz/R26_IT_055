"""
face-verification/backend/app/main.py
"""
import sys, os
from pathlib import Path
root_dir = Path(__file__).resolve().parents[3]
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes.face_routes import router as face_router

app = FastAPI(
    title="Secure Elder Care — Face Verification Service",
    version="1.0.0",
    description="Handles MTCNN and FaceNet embedding processing.",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(face_router, prefix="/api/face", tags=["Face ML"])


@app.get("/health")
def health():
    return {"status": "ok", "service": "face-verification"}
