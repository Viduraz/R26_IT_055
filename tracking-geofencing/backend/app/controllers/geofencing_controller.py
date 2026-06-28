"""
Geofencing controller — thin layer between routes and services.
"""

from app.services.geofence_service import (
    create_zone,
    get_all_zones,
    get_zone,
    update_zone,
    delete_zone,
    check_breach,
    get_alerts,
    resolve_alert,
)
from app.models.tracking_models import (
    ZoneCreateRequest,
    ZoneUpdateRequest,
    BreachCheckRequest,
)


async def handle_create_zone(request: ZoneCreateRequest) -> dict:
    """Create a new geofence zone."""
    return await create_zone(
        name=request.name,
        zone_type=request.zone_type,
        polygon=request.polygon,
        color=request.color,
    )


async def handle_get_all_zones() -> list:
    """Retrieve all zones."""
    return await get_all_zones()


async def handle_get_zone(zone_id: str) -> dict:
    """Retrieve a single zone."""
    return await get_zone(zone_id)


async def handle_update_zone(zone_id: str, request: ZoneUpdateRequest) -> dict:
    """Update an existing zone."""
    update_data = request.model_dump(exclude_none=True)
    return await update_zone(zone_id, update_data)


async def handle_delete_zone(zone_id: str) -> bool:
    """Delete a zone."""
    return await delete_zone(zone_id)


async def handle_check_breach(request: BreachCheckRequest) -> dict:
    """Check if a person's position breaches any zone."""
    return await check_breach(
        person_id=request.person_id,
        x=request.x,
        y=request.y,
    )


async def handle_get_alerts(resolved: bool = None) -> list:
    """Get all alerts."""
    return await get_alerts(resolved)


async def handle_resolve_alert(alert_id: str) -> dict:
    """Resolve an alert."""
    return await resolve_alert(alert_id)
