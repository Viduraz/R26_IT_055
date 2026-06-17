"""
schedule-monitoring/backend/app/services/notification_service.py
Handles creation and retrieval of family notifications.
"""
import uuid
from datetime import datetime
from shared.backend.config.database import get_db


def _notifications():
    return get_db()["notifications"]


class NotificationService:

    def create_notification(
        self,
        patient_id: str,
        task_name: str,
        alert_type: str,
        message: str,
    ) -> None:
        """Insert a new notification for the family member."""
        _notifications().insert_one({
            "notification_id": str(uuid.uuid4()),
            "patient_id": patient_id,
            "task_name": task_name,
            "alert_type": alert_type,   # "late" | "missed" | "caregiver_missing"
            "message": message,
            "created_at": datetime.utcnow(),
            "read": False,
        })

    def get_notifications(self, patient_id: str, limit: int = 50) -> list:
        """Return latest notifications for a patient (newest first)."""
        notifs = list(
            _notifications()
            .find({"patient_id": patient_id}, {"_id": 0})
            .sort("created_at", -1)
            .limit(limit)
        )
        for n in notifs:
            if isinstance(n.get("created_at"), datetime):
                n["created_at"] = n["created_at"].isoformat()
        return notifs

    def mark_read(self, notification_id: str) -> dict:
        res = _notifications().update_one(
            {"notification_id": notification_id},
            {"$set": {"read": True}},
        )
        return {"success": res.modified_count > 0}

    def mark_all_read(self, patient_id: str) -> dict:
        res = _notifications().update_many(
            {"patient_id": patient_id, "read": False},
            {"$set": {"read": True}},
        )
        return {"updated": res.modified_count}

    def get_unread_count(self, patient_id: str) -> int:
        return _notifications().count_documents(
            {"patient_id": patient_id, "read": False}
        )
