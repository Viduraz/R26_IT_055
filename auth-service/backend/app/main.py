"""
auth-service/backend/app/main.py
FastAPI entry point for the Authentication Service.
"""
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
