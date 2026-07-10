from datetime import datetime, timedelta
import numpy as np
import uuid

"""
schedule-monitoring/backend/app/services/schedule_service.py
Full CRUD for patient schedule items.
"""
import uuid
from datetime import datetime

from shared.backend.config.database import get_db

def _schedules():
    return get_db()["schedules"]

def _activity_logs():
    return get_db()["activity_logs"]

def _notifications():
    return get_db()["notifications"]

def _deviations():
    return get_db()["deviations"]


# Timing Configuration for Presentation & Testing (Easily adjustable)
TIMING_CONFIG = {
    "DURATION_MINUTES": 3.0,
    "LATE_THRESHOLD_MINUTES": 1.5,
    "START_OFFSET_MINUTES": 2.0
}


def _local_now() -> datetime:
    return datetime.now()


def _parse_time_value(time_value):
    if isinstance(time_value, datetime):
        return time_value.time()
    if hasattr(time_value, "hour") and hasattr(time_value, "minute") and not isinstance(time_value, str):
        return time_value
    if isinstance(time_value, str):
        return datetime.strptime(time_value, "%H:%M").time()
    raise ValueError(f"Unsupported time value: {time_value!r}")


def _normalize_schedule_activities(activities: list, anchor: datetime | None = None) -> list:
    normalized = []
    base_start = (anchor or _local_now()).replace(second=0, microsecond=0)
    base_start += timedelta(minutes=TIMING_CONFIG["START_OFFSET_MINUTES"])

    duration = timedelta(minutes=TIMING_CONFIG["DURATION_MINUTES"])
    spacing = timedelta(minutes=TIMING_CONFIG["DURATION_MINUTES"])

    for index, activity in enumerate(activities or []):
        if hasattr(activity, "model_dump"):
            activity = activity.model_dump()
        elif not isinstance(activity, dict):
            activity = dict(activity)

        start_dt = base_start + (spacing * index)
        end_dt = start_dt + duration

        normalized_activity = dict(activity)
        normalized_activity["start_time"] = start_dt.strftime("%H:%M")
        normalized_activity["end_time"] = end_dt.strftime("%H:%M")
        normalized.append(normalized_activity)

    return normalized


class ScheduleService:

    """
    Schedule Service with Adaptive Thresholds (Phase 1 ML)
    """

    # ====================== ML-BASED ADAPTIVE MONITORING ======================

    def get_adaptive_grace_period(self, user_id: str, activity_name: str) -> float:
        """Learns personalized grace period from past behavior using ML/statistics"""
        logs = list(_activity_logs().find({
            "user_id": user_id,
            "activity_name": {"$regex": f"^{activity_name}$", "$options": "i"}
        }).sort("detected_at", -1).limit(50))

        fallback_threshold = TIMING_CONFIG["LATE_THRESHOLD_MINUTES"]
        if len(logs) < 8:
            return fallback_threshold

        delays = []
        for log in logs:
            expected_start_str = log.get("expected_start")
            detected_at_dt = log.get("detected_at")
            if not expected_start_str or not detected_at_dt:
                continue

            if isinstance(detected_at_dt, str):
                try:
                    detected_at_dt = datetime.fromisoformat(detected_at_dt)
                except ValueError:
                    continue

            try:
                expected_time_obj = datetime.strptime(expected_start_str, "%H:%M").time()
                expected_dt = datetime.combine(detected_at_dt.date(), expected_time_obj)

                delay_min = (detected_at_dt.replace(tzinfo=None) - expected_dt.replace(tzinfo=None)).total_seconds() / 60.0

                duration = TIMING_CONFIG["DURATION_MINUTES"]
                if -2.0 * duration < delay_min < 5.0 * duration:
                    delays.append(delay_min)
            except Exception:
                continue

        if len(delays) < 6:
            return fallback_threshold

        delays_arr = np.array(delays)
        mean_delay = float(np.mean(delays_arr))
        std_delay = float(np.std(delays_arr))

        grace = mean_delay + (1.8 * std_delay)

        min_grace = 0.6 * TIMING_CONFIG["DURATION_MINUTES"]
        max_grace = 1.5 * TIMING_CONFIG["DURATION_MINUTES"]
        grace = max(min_grace, min(max_grace, grace))
        return round(grace, 1)

    def check_activity_status(self, user_id: str, activity_name: str, expected_start: datetime, detected_at: datetime) -> dict:
        """Determines activity status using statistical adaptive thresholds"""
        grace_minutes = self.get_adaptive_grace_period(user_id, activity_name)
        duration_minutes = TIMING_CONFIG["DURATION_MINUTES"]

        detected_naive = detected_at.replace(tzinfo=None)
        expected_naive = expected_start.replace(tzinfo=None)

        deadline = expected_naive + timedelta(minutes=grace_minutes)
        missed_boundary = expected_naive + timedelta(minutes=duration_minutes)

        diff_seconds = (detected_naive - expected_naive).total_seconds()
        delay_minutes = round(diff_seconds / 60, 1)

        if detected_naive < expected_naive:
            status = "Early"
            confidence = 0.90
        elif detected_naive <= deadline:
            status = "Completed"
            confidence = 0.92
        elif detected_naive <= missed_boundary:
            status = "Late"
            confidence = 0.65
        else:
            status = "Missed"
            confidence = 0.52

        return {
            "status": status,
            "completion_state": "completed" if status in {"Early", "Completed", "Late"} else "not_completed",
            "grace_minutes": grace_minutes,
            "delay_minutes": delay_minutes,
            "confidence": confidence,
            "deadline": deadline.isoformat(),
            "missed_boundary": missed_boundary.isoformat()
        }

    # ====================== MAIN LOGGING FUNCTION ======================

    def log_activity_detection(self, schedule_id: str, activity_name: str,
                               detected_at: datetime, confidence: float, signals: dict):
        """Main function called from frontend"""
        schedule = _schedules().find_one({"schedule_id": schedule_id})
        if not schedule:
            return {"error": "Schedule not found"}

        target_activity = None
        activities = schedule.get("activities", []) if isinstance(schedule, dict) else getattr(schedule, "activities", [])

        for act in activities:
            act_name = act.get("activity_name", "") if isinstance(act, dict) else getattr(act, "activity_name", "")
            if act_name.lower() == activity_name.lower():
                target_activity = act
                break

        if not target_activity:
            return {"error": f"Activity '{activity_name}' not found in schedule"}

        target_start = target_activity.get("start_time") if isinstance(target_activity, dict) else target_activity.start_time
        start_time = _parse_time_value(target_start)
        expected_start = datetime.combine(_local_now().date(), start_time)

        status_info = self.check_activity_status(
            user_id=schedule["user_id"],
            activity_name=activity_name,
            expected_start=expected_start,
            detected_at=detected_at
        )

        log_entry = {
            "schedule_id": schedule_id,
            "user_id": schedule["user_id"],
            "activity_name": activity_name,
            "expected_start": target_activity.get("start_time") if isinstance(target_activity, dict) else target_activity.start_time,
            "expected_end": target_activity.get("end_time") if isinstance(target_activity, dict) else target_activity.end_time,
            "detected_at": detected_at,
            "status": status_info["status"],
            "completion_state": status_info["completion_state"],
            "adaptive_grace_minutes": status_info["grace_minutes"],
            "delay_minutes": status_info["delay_minutes"],
            "detection_confidence": confidence,
            "signals": signals,
            "created_at": datetime.utcnow()
        }

        result = _activity_logs().insert_one(log_entry)

        if status_info["status"] in ["Late", "Missed"]:
            self.create_notification(
                schedule["user_id"],
                activity_name,
                status_info["status"],
                f"{activity_name} was detected {status_info['status'].lower()} "
                f"(Delay: {status_info['delay_minutes']} min. Completion limit: {status_info['grace_minutes']} min)."
            )

        log_entry["_id"] = str(result.inserted_id)
        return log_entry

    # ── CRUD (legacy async versions — DEAD CODE, see note below) ──────

    async def get_all_schedules(self) -> list:
        docs = list(_schedules().find({}, {"_id": 0}))
        return docs

    async def get_schedules_by_patient(self, patient_id: str) -> list:
        docs = list(_schedules().find({"patient_id": patient_id}, {"_id": 0}))
        return docs

    # NOTE: Python only keeps the LAST method with a given name in a class
    # body. The sync create_schedule/delete_schedule/get_schedule/get_reports/
    # get_deviations defined further down in this file override the ones
    # that used to live here. This comment marks where that dead code was
    # removed to avoid confusion; the real, active implementations are in
    # the "ACTIVE METHODS" section below.

    async def update_schedule(self, schedule_id: str, data: dict) -> dict:
        update_data = {k: v for k, v in data.items() if v is not None}
        update_data["updated_at"] = datetime.utcnow()
        res = _schedules().update_one(
            {"schedule_id": schedule_id},
            {"$set": update_data},
        )
        return {"success": res.matched_count > 0}

    async def log_deviation(self, schedule_id: str, observed: str, expected: str):
        _deviations().insert_one({
            "schedule_id": schedule_id,
            "observed": observed,
            "expected": expected,
            "created_at": datetime.utcnow(),
        })

    # ====================== BACKGROUND TASKS ======================

    def check_missed_activities(self):
        """Background task to check for missed/not done activities."""
        schedules = list(_schedules().find({}))
        local_now = _local_now()

        for schedule in schedules:
            user_id = schedule.get("user_id")
            schedule_id = schedule.get("schedule_id")
            activities = schedule.get("activities", []) if isinstance(schedule, dict) else getattr(schedule, "activities", [])
            for activity in activities:
                activity_name = activity.get("activity_name") if isinstance(activity, dict) else getattr(activity, "activity_name", None)
                end_time_str = activity.get("end_time") if isinstance(activity, dict) else getattr(activity, "end_time", None)
                if not end_time_str:
                    continue

                try:
                    end_time_obj = datetime.strptime(end_time_str, "%H:%M").time()
                    expected_end = datetime.combine(local_now.date(), end_time_obj)
                except ValueError:
                    continue

                if local_now > expected_end:
                    start_of_day = datetime.combine(local_now.date(), datetime.min.time())
                    end_of_day = datetime.combine(local_now.date(), datetime.max.time())

                    log = _activity_logs().find_one({
                        "schedule_id": schedule_id,
                        "activity_name": activity_name,
                        "created_at": {"$gte": start_of_day, "$lte": end_of_day}
                    })

                    if not log:
                        log_entry = {
                            "schedule_id": schedule_id,
                            "user_id": user_id,
                            "activity_name": activity_name,
                            "expected_start": activity.get("start_time") if isinstance(activity, dict) else getattr(activity, "start_time", None),
                            "expected_end": activity.get("end_time") if isinstance(activity, dict) else getattr(activity, "end_time", None),
                            "detected_at": None,
                            "status": "Not Done",
                            "adaptive_grace_minutes": TIMING_CONFIG["LATE_THRESHOLD_MINUTES"],
                            "delay_minutes": None,
                            "detection_confidence": 1.0,
                            "signals": {},
                            "created_at": datetime.utcnow()
                        }
                        _activity_logs().insert_one(log_entry)

                        self.create_notification(
                            user_id,
                            activity_name,
                            "Not Done",
                            f"{activity_name} was not done throughout the scheduled time."
                        )

    # ====================== ACTIVE METHODS ======================

    def create_schedule(self, user_id: str, activities: list, description: str = None):
        """Create a new schedule for a user.

        FIX: previously this always did a plain insert_one(), so every
        "Save Routine" click left the OLD schedule(s) sitting in Mongo
        alongside the new one. The dashboard only ever displays schedule[0]
        from the returned list, so old routines could silently reappear
        later — including making "Delete Routine" look broken, when really
        it deleted one document while a stale duplicate remained.

        Now we delete any existing schedule(s) + their logs/notifications
        for this user BEFORE inserting the new one, enforcing "one active
        routine per user" to match what the UI already assumes.
        """
        existing = list(_schedules().find({"user_id": user_id}))
        for old in existing:
            _activity_logs().delete_many({"schedule_id": old["schedule_id"]})
        _notifications().delete_many({"user_id": user_id})
        _schedules().delete_many({"user_id": user_id})

        schedule_id = str(uuid.uuid4())
        normalized_activities = _normalize_schedule_activities(activities)
        schedule = {
            "schedule_id": schedule_id,
            "user_id": user_id,
            "activities": normalized_activities,
            "description": description or "",
            "created_at": _local_now(),
            "updated_at": _local_now()
        }
        result = _schedules().insert_one(schedule)
        schedule["_id"] = str(result.inserted_id)
        return schedule

    def delete_schedule(self, user_id: str, schedule_id: str):
        """Delete a schedule and all associated logs/notifications.

        FIX: now deletes ALL schedules for this user_id (not just the one
        matching schedule_id) as a safety net against any duplicate/stale
        documents left over from before the create_schedule fix above.
        Also clears notifications, which the old version never touched.
        """
        matching = list(_schedules().find({"user_id": user_id}))
        if not matching:
            return {"error": "Schedule not found or you don't have permission to delete it", "deleted": False}

        result = _schedules().delete_many({"user_id": user_id})
        for sched in matching:
            _activity_logs().delete_many({"schedule_id": sched["schedule_id"]})
        _notifications().delete_many({"user_id": user_id})

        return {"message": "Schedule deleted successfully", "deleted": result.deleted_count > 0}

    def get_schedule(self, user_id: str = None):
        """Get all schedules for a user"""
        if user_id:
            schedules = list(_schedules().find({"user_id": user_id}))
        else:
            schedules = list(_schedules().find({}))

        for s in schedules:
            s["_id"] = str(s["_id"])
            if "activities" in s and isinstance(s["activities"], list):
                s["activities"] = [
                    a.model_dump() if hasattr(a, "model_dump") else
                    (dict(a) if not isinstance(a, dict) else a)
                    for a in s["activities"]
                ]
        return schedules

    def get_activity_logs(self, user_id: str = None, limit: int = 100):
        """Get activity logs"""
        query = {"user_id": user_id} if user_id else {}
        logs = list(_activity_logs().find(query).sort("created_at", -1).limit(limit))
        for log in logs:
            log["_id"] = str(log["_id"])
        return logs

    def create_notification(self, user_id: str, activity_name: str, status: str, message: str):
        """Create a notification"""
        notification = {
            "notification_id": str(uuid.uuid4()),
            "user_id": user_id,
            "activity_name": activity_name,
            "status": status,
            "message": message,
            "read": False,
            "created_at": datetime.utcnow()
        }
        result = _notifications().insert_one(notification)
        notification["_id"] = str(result.inserted_id)
        return notification

    def get_notifications(self, user_id: str = None, unread_only: bool = False):
        """Get notifications"""
        query = {"user_id": user_id} if user_id else {}
        if unread_only:
            query["read"] = False
        notifs = list(_notifications().find(query).sort("created_at", -1).limit(50))
        for n in notifs:
            n["_id"] = str(n["_id"])
        return notifs

    def mark_notification_read(self, notification_id: str):
        """Mark notification as read"""
        result = _notifications().update_one(
            {"notification_id": notification_id},
            {"$set": {"read": True}}
        )
        return {"matched": result.matched_count, "modified": result.modified_count}

    def get_reports(self, user_id: str = None):
        """Get activity reports"""
        logs = self.get_activity_logs(user_id)
        stats = {
            "Early": 0,
            "Completed": 0,
            "Late": 0,
            "Missed": 0,
            "Not Done": 0,
            "total": len(logs)
        }
        for log in logs:
            status = log.get("status", "Unknown")
            if status in stats:
                stats[status] += 1
        return {"stats": stats, "logs": logs}

    def get_deviations(self, user_id: str = None):
        """Get deviations from schedule"""
        query = {"user_id": user_id} if user_id else {}
        deviations = list(_deviations().find(query).sort("detected_at", -1).limit(50))
        for d in deviations:
            d["_id"] = str(d["_id"])
        return deviations
