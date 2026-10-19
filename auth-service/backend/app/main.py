"""
auth-service/backend/app/main.py
FastAPI entry point for the Authentication Service.
"""
import sys, os
from pathlib import Path
root_dir = Path(__file__).resolve().parents[3]
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes.auth_routes import router as auth_router

app = FastAPI(
    title="Secure Elder Care — Auth Service",
    version="1.0.0",
    description="Handles user registration, login, and JWT issuance.",
)

# CORS — allow any origin for Cloudflare tunnel + local dev
# JWT auth uses Authorization headers, not cookies — allow_credentials=False is correct.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api/auth", tags=["Auth"])


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "auth-service"}

@app.get("/db-status")
def db_status():
    from shared.backend.config.database import get_db
    from app.models.user_model import user_collection
    db = get_db()
    users = list(user_collection().find({}))
    return {"type": str(type(db)), "users": len(users)}
