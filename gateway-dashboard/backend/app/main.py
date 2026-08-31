"""
gateway-dashboard/backend/app/main.py
Acts as a central aggregator — calls other services and merges their data.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes.gateway_routes import router as gateway_router
from app.routes.dashboard_routes import router as dashboard_router

app = FastAPI(
    title="Secure Elder Care — Gateway Dashboard",
    version="1.0.0",
    description="Central entry point and API gateway providing analytics.",
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

app.include_router(dashboard_router, prefix="/api/dashboard", tags=["Dashboards"])

app.include_router(gateway_router, prefix="/api/gateway", tags=["Gateway"])


@app.get("/health")
def health():
    return {"status": "ok", "service": "gateway-dashboard"}
