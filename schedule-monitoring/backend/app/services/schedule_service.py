"""
schedule-monitoring/backend/app/services/schedule_service.py
Handles routine schedule CRUD and deviation detection.
"""
from datetime import datetime
from shared.backend.config.database import get_db


def _schedules():
    return get_db()["schedules"]


def _reports():
    return get_db()["reports"]


def _deviations():
    return get_db()["deviations"]


class ScheduleService:
    async def get_schedule(self) -> list:
        return list(_schedules().find({}, {"_id": 0}))

    async def get_reports(self) -> list:
        return list(_reports().find({}, {"_id": 0}).sort("generated_at", -1).limit(30))

    async def get_deviations(self) -> list:
        return list(_deviations().find({}, {"_id": 0}).sort("detected_at", -1).limit(50))

    async def log_deviation(self, schedule_id: str, observed: str, expected: str):
        """
        TODO: call from ML inference pipeline when deviation is detected.
        """
        _deviations().insert_one({
            "schedule_id": schedule_id,
            "observed_activity": observed,
            "expected_activity": expected,
            "detected_at": datetime.utcnow(),
        })
