import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.routes.tracking import router as tracking_router
from app.routes.geofencing import router as geofencing_router

app = FastAPI(title="Tracking & Geofencing Service", version="1.0.0")

# CORS must be first — so even error responses get CORS headers
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5175", "http://localhost:8002", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global exception handler — never let unhandled errors crash the response
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    print(f"[ERROR] Unhandled exception on {request.url}: {exc}")
    return JSONResponse(
        status_code=500,
        content={"error": str(exc), "detail": "Internal server error"},
        headers={"Access-Control-Allow-Origin": "*"},
    )

app.include_router(tracking_router, prefix="/api/tracking", tags=["Tracking"])
app.include_router(geofencing_router, prefix="/api/geofence", tags=["Geofencing"])

@app.get("/health")
async def health():
    from datetime import datetime
    from app.database.db import get_client
    
    try:
        client = get_client()
        if client is None:
            raise Exception("MongoDB client is None")
        # Ping the admin database to verify active connection
        await client.admin.command("ping")
        return {
            "status": "ok",
            "database": "connected",
            "service": "tracking-geofencing",
            "timestamp": datetime.utcnow().isoformat()
        }
    except Exception as e:
        print(f"[ERROR] Health check failed: {e}")
        return JSONResponse(
            status_code=503,
            content={
                "status": "offline",
                "database": "disconnected",
                "detail": str(e),
                "service": "tracking-geofencing",
                "timestamp": datetime.utcnow().isoformat()
            },
            headers={"Access-Control-Allow-Origin": "*"}
        )


@app.on_event("startup")
async def startup_event():
    print("\n=== REGISTERED ROUTES ===")
    for route in app.routes:
        if hasattr(route, "methods"):
            print(f"{route.methods} {route.path}")
    print("=========================\n")
