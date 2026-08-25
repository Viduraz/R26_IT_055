"""
Geofencing routes — mounted at /api/geofence by main.py
No prefix is added here; the prefix comes from app.include_router().
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from datetime import datetime, timezone
from typing import Optional
from app.controllers.geofencing_controller import (
    handle_create_zone,
    handle_get_all_zones,
    handle_get_zone,
    handle_update_zone,
    handle_delete_zone,
    handle_check_breach,
    handle_get_alerts,
    handle_resolve_alert,
    handle_clear_alerts,
)
from app.models.tracking_models import (
    ZoneCreateRequest,
    ZoneUpdateRequest,
    BreachCheckRequest,
)

router = APIRouter()

# ── In-memory Mobile GPS Store ──────────────────────────────────────────────
# Stores the latest GPS coordinate pushed from a mobile phone.
_mobile_gps_store: dict = {}


class MobileGpsPayload(BaseModel):
    lat: float
    lng: float
    accuracy: Optional[float] = None
    session_id: Optional[str] = "default"


@router.post("/zones")
async def create_zone(
    request: ZoneCreateRequest,
):
    """Create a new geofence zone."""
    zone = await handle_create_zone(request)
    return zone


@router.get("/zones")
async def get_zones():
    """Retrieve all geofence zones."""
    return await handle_get_all_zones()


@router.get("/zones/{zone_id}")
async def get_zone(
    zone_id: str,
):
    """Retrieve a single geofence zone."""
    zone = await handle_get_zone(zone_id)
    if zone is None:
        raise HTTPException(status_code=404, detail="Zone not found")
    return zone


@router.put("/zones/{zone_id}")
async def update_zone(
    zone_id: str,
    request: ZoneUpdateRequest,
):
    """Update an existing geofence zone."""
    zone = await handle_update_zone(zone_id, request)
    if zone is None:
        raise HTTPException(status_code=404, detail="Zone not found")
    return zone


@router.delete("/zones/{zone_id}")
async def delete_zone(
    zone_id: str,
):
    """Delete a geofence zone."""
    deleted = await handle_delete_zone(zone_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Zone not found")
    return {"message": "Zone deleted successfully", "zone_id": zone_id}


@router.post("/check-breach")
async def check_breach(
    request: BreachCheckRequest,
):
    """Check if a person's position breaches any active zone."""
    return await handle_check_breach(request)


@router.get("/alerts")
async def get_alerts(
    resolved: bool = Query(None),
    since: str = Query(None),
):
    """Retrieve geofence alerts, optionally filtered by resolved status and since timestamp."""
    return await handle_get_alerts(resolved, since)


@router.delete("/alerts")
async def clear_alerts():
    """Clear all geofence alerts."""
    return await handle_clear_alerts()


@router.put("/alerts/{alert_id}/resolve")
async def resolve_alert(
    alert_id: str,
):
    """Mark an alert as resolved."""
    alert = await handle_resolve_alert(alert_id)
    if alert is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    return alert


# ── Mobile GPS Endpoints ─────────────────────────────────────────────────────

@router.post("/mobile-gps")
async def receive_mobile_gps(payload: MobileGpsPayload):
    """Receive live GPS location from a mobile companion page."""
    _mobile_gps_store["latest"] = {
        "lat": payload.lat,
        "lng": payload.lng,
        "accuracy": payload.accuracy,
        "session_id": payload.session_id,
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    return {"status": "ok"}


@router.get("/mobile-gps")
async def get_mobile_gps():
    """Return the latest GPS location received from a mobile device."""
    data = _mobile_gps_store.get("latest")
    if not data:
        return JSONResponse(status_code=404, content={"detail": "No mobile GPS data yet"})
    return data
