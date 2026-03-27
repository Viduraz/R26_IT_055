"""
gateway-dashboard/backend/app/main.py
Acts as a central aggregator — calls other services and merges their data.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes.gateway_routes import router as gateway_router

app = FastAPI(
    title="Secure Elder Care — Gateway Dashboard Service",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

app.include_router(gateway_router, prefix="/api/gateway", tags=["Gateway"])


@app.get("/health")
def health():
    return {"status": "ok", "service": "gateway-dashboard"}
