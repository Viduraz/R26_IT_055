"""
face-verification/backend/app/main.py
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes.face_routes import router as face_router

app = FastAPI(
    title="Secure Elder Care — Face Verification Service",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

app.include_router(face_router, prefix="/api/face", tags=["Face Verification"])


@app.get("/health")
def health():
    return {"status": "ok", "service": "face-verification"}
