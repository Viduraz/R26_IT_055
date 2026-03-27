"""
tracking-geofencing/backend/app/services/tracking_service.py
Orchestrates YOLOv8 detection + ByteTrack + geofence logic.
"""
from datetime import datetime
from shared.backend.config.database import get_db


def _logs():
    return get_db()["tracking_logs"]


def _zones():
    return get_db()["zones"]


class TrackingService:
    async def process_frame(self, user_id: str) -> dict:
        """
        TODO:
        1. Decode frame bytes → numpy
        2. Run YOLOv8 person detection (detect_person.py)
        3. Pass detections to ByteTrack (track_person.py)
        4. Check tracked positions against zones (geofence_check.py)
        5. Trigger alert if violation
        6. Log to MongoDB
        """
        _logs().insert_one({"user_id": user_id, "event": "stub", "timestamp": datetime.utcnow()})
        return {"message": "Tracking pipeline stub — implement YOLOv8 + ByteTrack."}

    async def list_zones(self) -> list:
        return list(_zones().find({}, {"_id": 0}))

    async def get_history(self) -> list:
        return list(_logs().find({}, {"_id": 0}).sort("timestamp", -1).limit(50))
