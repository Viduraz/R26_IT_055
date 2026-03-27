"""
gateway-dashboard/backend/app/services/dashboard_service.py
Aggregates health and summary data from all microservices.
"""
import httpx
from shared.backend.config.settings import settings


class DashboardService:
    async def get_overview(self) -> dict:
        """
        Fetch /health from each backend and compile a status overview.
        TODO: extend with real metric aggregation.
        """
        services = {
            "auth": settings.AUTH_SERVICE_URL,
            "face": settings.FACE_SERVICE_URL,
            "tracking": settings.TRACKING_SERVICE_URL,
            "anomaly": settings.ANOMALY_SERVICE_URL,
            "schedule": settings.SCHEDULE_SERVICE_URL,
        }
        statuses = {}
        async with httpx.AsyncClient(timeout=3.0) as client:
            for name, base_url in services.items():
                try:
                    r = await client.get(f"{base_url}/health")
                    statuses[name] = r.json().get("status", "unknown")
                except Exception:
                    statuses[name] = "unreachable"
        return {"services": statuses}
