"""
schedule-monitoring/backend/app/services/notification_service.py
Sends notifications to both the owner and the caregiver whenever an
activity is marked Late, Missed, or otherwise deviates from schedule.

Simplified: no caregiver-identity linkage table yet — both notifications
are scoped to the same patient_id, tagged by recipient_role so each screen
(owner view vs caregiver view) can filter to what's relevant to it.
When real caregiver account linkage exists, only _get_recipient_roles()
below needs to change.
"""
import uuid
from datetime import datetime
from shared.backend.config.database import get_db


def _notifications():
    return get_db()["notifications"]


class NotificationService:

    def _get_recipient_roles(self) -> list:
        """
        Which roles get notified for every event.
        Swap this out once caregiver accounts are properly linked to a patient.
        """
        return ["owner", "caregiver"]

    def create_notification(
        self,
        patient_id: str,
        task_name: str,
        alert_type: str,   # "late" | "missed" | "caregiver_missing" | etc.
        message: str,
    ) -> list:
        """Insert one notification per recipient role for this patient."""
        now = datetime.utcnow()
        created_ids = []

        for role in self._get_recipient_roles():
            notif = {
                "notification_id": str(uuid.uuid4()),
                "patient_id":      patient_id,
                "task_name":       task_name,
                "alert_type":      alert_type,
                "message":         message,
                "recipient_role":  role,   # "owner" or "caregiver"
                "created_at":      now,
                "read":            False,
            }
            _notifications().insert_one(notif)
            created_ids.append(notif["notification_id"])

        return created_ids

    def get_notifications(self, patient_id: str, role: str = None, limit: int = 50) -> list:
        """
        Return notifications for a patient. Pass role="owner" or role="caregiver"
        to filter to just that screen; omit role to get everything.
        """
        query = {"patient_id": patient_id}
        if role:
            query["recipient_role"] = role

        notifs = list(
            _notifications()
            .find(query, {"_id": 0})
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

    def mark_all_read(self, patient_id: str, role: str = None) -> dict:
        query = {"patient_id": patient_id, "read": False}
        if role:
            query["recipient_role"] = role
        res = _notifications().update_many(query, {"$set": {"read": True}})
        return {"updated": res.modified_count}

    def get_unread_count(self, patient_id: str, role: str = None) -> int:
        query = {"patient_id": patient_id, "read": False}
        if role:
            query["recipient_role"] = role
        return _notifications().count_documents(query)