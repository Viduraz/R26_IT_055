"""
caregiver-marketplace/backend/app/services/monitor_service.py
Validates patient IDs and aggregates live status from existing monitoring services.
"""
import httpx
from fastapi import HTTPException, status
from shared.backend.config.settings import settings
from app.services.booking_service import BookingService


class MonitorService:

    def __init__(self):
        self._booking_svc = BookingService()

    async def validate_patient_id(self, patient_id: str, user_id: str) -> dict | None:
        """
        Validate that the patient ID exists and belongs to the logged-in user.
        Returns the booking document if valid, None otherwise.
        """
        booking = await self._booking_svc.get_booking_by_patient_id(patient_id)
        if not booking:
            return None

        # The user must be the family member or the assigned caregiver
        if booking.get("family_user_id") != user_id and booking.get("caregiver_user_id") != user_id:
            return None

        if booking.get("status") != "confirmed":
            return None

        return booking

    async def get_live_status(self, patient_id: str) -> dict:
        """
        Aggregate live monitoring data from existing services.
        Fetches data from anomaly-detection, tracking-geofencing, and schedule-monitoring.
        """
        booking = await self._booking_svc.get_booking_by_patient_id(patient_id)
        if not booking:
            return {"error": "Patient ID not found"}

        elder_name = booking.get("elder", {}).get("name", "Unknown")
        caregiver_name = booking.get("caregiver_name", "Unknown")

        status = {
            "patient_id": patient_id,
            "elder_name": elder_name,
            "caregiver_name": caregiver_name,
            "booking_status": booking.get("status", "unknown"),
            "anomaly": None,
            "tracking": None,
            "schedule": None,
            "services_status": {},
        }

        async with httpx.AsyncClient(timeout=5.0) as client:
            # 1. Anomaly Detection Service
            try:
                resp = await client.get(f"{settings.ANOMALY_SERVICE_URL}/api/anomaly/metrics")
                if resp.status_code == 200:
                    status["anomaly"] = resp.json()
                    status["services_status"]["anomaly"] = "online"
                else:
                    status["services_status"]["anomaly"] = "error"
            except Exception:
                status["services_status"]["anomaly"] = "offline"

            # 2. Tracking & Geofencing Service
            try:
                resp = await client.get(f"{settings.TRACKING_SERVICE_URL}/health")
                if resp.status_code == 200:
                    status["services_status"]["tracking"] = "online"
                else:
                    status["services_status"]["tracking"] = "error"
            except Exception:
                status["services_status"]["tracking"] = "offline"

            # 3. Schedule Monitoring Service
            try:
                resp = await client.get(f"{settings.SCHEDULE_SERVICE_URL}/health")
                if resp.status_code == 200:
                    status["services_status"]["schedule"] = "online"
                else:
                    status["services_status"]["schedule"] = "error"
            except Exception:
                status["services_status"]["schedule"] = "offline"

        return status

    async def get_video_frame(self, patient_id: str, user_id: str, token: str) -> dict:
        """
        Proxy a single JPEG frame from the anomaly-detection camera-snapshot endpoint.
        Validates the patient ID belongs to the requesting user first.
        Returns { "frame": "data:image/jpeg;base64,..." }
        """
        booking = await self.validate_patient_id(patient_id, user_id)
        if not booking:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not authorized to stream video for this Patient ID."
            )

        headers = {"Authorization": f"Bearer {token}"}
        async with httpx.AsyncClient(timeout=6.0) as client:
            try:
                resp = await client.get(
                    f"{settings.ANOMALY_SERVICE_URL}/api/anomaly/camera-snapshot",
                    headers=headers,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    # camera-snapshot returns a plain string (the data URL)
                    frame = data if isinstance(data, str) else data.get("frame") or data.get("snapshot")
                    return {"frame": frame}
                else:
                    raise HTTPException(
                        status_code=resp.status_code,
                        detail=f"Camera snapshot error: {resp.text[:200]}"
                    )
            except HTTPException:
                raise
            except Exception as exc:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=f"Anomaly service unreachable: {type(exc).__name__}"
                )
