"""
schedule-monitoring/backend/app/services/schedule_service.py
Full CRUD for patient schedule items.
"""
import uuid
from datetime import datetime
from shared.backend.config.database import get_db


def _schedules():
    return get_db()["schedules"]


def _reports():
    return get_db()["reports"]


def _deviations():
    return get_db()["deviations"]


class ScheduleService:

    # ── CRUD ───────────────────────────────────────────────────────────

    async def get_all_schedules(self) -> list:
        docs = list(_schedules().find({}, {"_id": 0}))
        return docs

    async def get_schedules_by_patient(self, patient_id: str) -> list:
        docs = list(_schedules().find({"patient_id": patient_id}, {"_id": 0}))
        return docs

    async def create_schedule(self, data: dict) -> dict:
        data["schedule_id"] = str(uuid.uuid4())
        data["created_at"] = datetime.utcnow()
        data["today_status"] = "pending"
        _schedules().insert_one(data)
        return {"success": True, "schedule_id": data["schedule_id"]}

    async def update_schedule(self, schedule_id: str, data: dict) -> dict:
        # Remove None values so we don't accidentally overwrite fields
        update_data = {k: v for k, v in data.items() if v is not None}
        update_data["updated_at"] = datetime.utcnow()
        res = _schedules().update_one(
            {"schedule_id": schedule_id},
            {"$set": update_data},
        )
        return {"success": res.matched_count > 0}

    async def delete_schedule(self, schedule_id: str) -> dict:
        res = _schedules().delete_one({"schedule_id": schedule_id})
        return {"success": res.deleted_count > 0}

    # ── Legacy helpers (kept for compatibility) ────────────────────────

    async def get_schedule(self) -> list:
        return await self.get_all_schedules()

    async def get_reports(self) -> list:
        return list(
            _reports().find({}, {"_id": 0}).sort("generated_at", -1).limit(30)
        )

    async def get_deviations(self) -> list:
        return list(
            _deviations().find({}, {"_id": 0}).sort("detected_at", -1).limit(50)
        )

    async def log_deviation(self, schedule_id: str, observed: str, expected: str):
        _deviations().insert_one({
            "schedule_id": schedule_id,
            "observed_activity": observed,
            "expected_activity": expected,
            "detected_at": datetime.utcnow(),
        })
