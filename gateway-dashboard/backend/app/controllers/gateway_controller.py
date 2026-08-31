"""
gateway-dashboard/backend/app/controllers/gateway_controller.py
"""
import httpx
from fastapi import HTTPException
from app.services.dashboard_service import DashboardService
from app.services.alert_aggregator_service import AlertAggregatorService

_dash = DashboardService()
_alerts = AlertAggregatorService()

# Map frontend service key → backend base URL
_SERVICE_URLS = {
    "auth":     "http://localhost:8000",
    "face":     "http://localhost:8001",
    "tracking": "http://localhost:8002",
    "anomaly":  "http://localhost:8003",
    "schedule": "http://localhost:8004",
}


async def get_system_overview(user: dict):
    return await _dash.get_overview()


async def get_alerts(user: dict):
    return await _alerts.aggregate_alerts()


async def get_health_proxy(service_key: str):
    """
    Proxy a /health call to the requested microservice.
    Returns {"status": "ok"} or {"status": "unreachable"}.
    """
    base_url = _SERVICE_URLS.get(service_key)
    if not base_url:
        raise HTTPException(status_code=404, detail=f"Unknown service key: {service_key}")
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{base_url}/health")
            status = r.json().get("status", "unknown") if r.is_success else "degraded"
    except Exception:
        status = "unreachable"
    return {"service": service_key, "status": status}
