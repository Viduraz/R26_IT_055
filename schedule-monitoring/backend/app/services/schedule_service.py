"""
schedule-monitoring/backend/app/services/schedule_service.py
CRUD for patient schedule items, notifications, and reporting.

CHANGED (vocabulary consolidation):
This file used to run its OWN parallel activity-detection status logic
(check_activity_status / log_activity_detection / check_missed_activities)
using a different status vocabulary ("Early"/"Completed"/"Late"/"Missed"/
"Not Done") than monitoring_service.py ("done"/"late"/"missed"/
"caregiver_missing"). Both wrote into the same `activity_logs` collection,
which meant any code reading logs by status only ever saw whichever half of
the vocabulary it was written to filter for — e.g. get_reports() here would
always show 0 for anything monitoring_service.py had logged, even though
those log entries existed.

monitoring_service.py is now the single canonical engine for detection
status and the 20-minute rule (matches the original spec: Done/Late/Missed
based on a fixed 20-minute grace period). This file is CRUD-only:
schedule create/delete/get, notifications, reports, deviations — all
reading/writing the same lowercase vocabulary monitoring_service.py uses.

REMOVED from this file (now dead, superseded by monitoring_service.py):
  - get_adaptive_grace_period() / check_activity_status() — the ML-lite
    adaptive-grace-period idea is genuinely nice; if you want it later,
    port it INTO monitoring_service.py's 20-minute rule as an optional
    per-user override, rather than running it as a second parallel engine.
  - log_activity_detection() — detection events should call
    MonitoringService.process_detection_event() instead (see
    schedule_routes.py / your controller — needs updating to point there).
  - check_missed_activities() — superseded by
    MonitoringService.evaluate_missed_tasks(), which is now the ONLY missed-
    task sweep. Make sure your background scheduler only starts ONE of
    these two, not both.
"""
from datetime import datetime, timedelta
import uuid
from shared.backend.config.database import get_db
from app.services.monitoring_service import STATUS_TO_DISPLAY


def _schedules():
    return get_db()["schedules"]


def _activity_logs():
    return get_db()["activity_logs"]


def _notifications():
    return get_db()["notifications"]


def _deviations():
    return get_db()["deviations"]


def _delete_many(collection, query: dict):
    delete_many = getattr(collection, "delete_many", None)
    if callable(delete_many):
        return delete_many(query)
    data = getattr(collection, "data", None)
    if isinstance(data, list):
        original_len = len(data)
        collection.data = [doc for doc in data if not all(doc.get(key) == value for key, value in query.items())]
        return type("DeleteResult", (), {"deleted_count": original_len - len(collection.data)})()
    return type("DeleteResult", (), {"deleted_count": 0})()


# ── Timing config ────────────────────────────────────────────────────────
# FIX: previously _normalize_schedule_activities() ALWAYS overwrote every
# activity's start_time/end_time with these fast test values, regardless of
# what the owner actually entered in the frontend — so a real schedule like
# "Eating: 7:50-8:20" silently became "starts 2 min from now, lasts 3 min"
# every time. That means the finished product could never honor an owner's
# real schedule.
#
# Set TESTING_MODE = True only while you want fast demo timing (e.g. showing
# your leader a Late/Missed notification within minutes instead of waiting
# for a real 8am slot). Set it to False for real usage — real start_time/
# end_time from the owner's input will then be preserved untouched.
TESTING_MODE = True

TIMING_CONFIG = {
    "DURATION_MINUTES": 3.0,
    "START_OFFSET_MINUTES": 2.0,
}


def _local_now() -> datetime:
    return datetime.now()


def _normalize_schedule_activities(activities: list, anchor: datetime | None = None) -> list:
    """
    In TESTING_MODE, auto-generates fast sequential start/end times so you can
    demo Done/Late/Missed within minutes.

    Otherwise (real usage), preserves whatever start_time/end_time the owner
    actually entered — only auto-filling if an activity is genuinely missing
    a time (defensive fallback, not the normal path).
    """
    normalized = []

    if TESTING_MODE:
        base_start = (anchor or _local_now()).replace(second=0, microsecond=0)
        base_start += timedelta(minutes=TIMING_CONFIG["START_OFFSET_MINUTES"])
        duration = timedelta(minutes=TIMING_CONFIG["DURATION_MINUTES"])
        spacing = timedelta(minutes=TIMING_CONFIG["DURATION_MINUTES"])

        for index, activity in enumerate(activities or []):
            activity = activity.model_dump() if hasattr(activity, "model_dump") else dict(activity)
            start_dt = base_start + (spacing * index)
            end_dt = start_dt + duration
            activity["start_time"] = start_dt.strftime("%H:%M")
            activity["end_time"] = end_dt.strftime("%H:%M")
            normalized.append(activity)
        return normalized

    # Real usage: keep the owner's actual times.
    for activity in activities or []:
        activity = activity.model_dump() if hasattr(activity, "model_dump") else dict(activity)
        if not activity.get("start_time") or not activity.get("end_time"):
            # Defensive fallback only — should rarely trigger if the frontend
            # form requires both fields.
            fallback_start = (anchor or _local_now()).replace(second=0, microsecond=0)
            activity["start_time"] = activity.get("start_time") or fallback_start.strftime("%H:%M")
            activity["end_time"] = activity.get("end_time") or (fallback_start + timedelta(minutes=30)).strftime("%H:%M")
        normalized.append(activity)
    return normalized


class ScheduleService:
    """Schedule CRUD, notifications, and reporting — no detection/status logic."""

    # ====================== SCHEDULE CRUD ======================
    def create_schedule(self, user_id: str, activities: list, description: str = None):
        """Create a new schedule for a user.

        Deletes any existing schedule(s) + their logs/notifications for this
        user BEFORE inserting the new one, enforcing "one active routine per
        user" to match what the UI already assumes (dashboard only ever
        displays schedule[0]).
        """
        existing = list(_schedules().find({"user_id": user_id}))
        for old in existing:
            _delete_many(_activity_logs(), {"schedule_id": old["schedule_id"]})
        _delete_many(_notifications(), {"user_id": user_id})
        _delete_many(_schedules(), {"user_id": user_id})

        schedule_id = str(uuid.uuid4())
        normalized_activities = _normalize_schedule_activities(activities)
        schedule = {
            "schedule_id": schedule_id,
            "user_id": user_id,
            "patient_id": user_id,   # monitoring_service._active_schedules() checks both keys
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

        Deletes ALL schedules for this user_id (not just the one matching
        schedule_id) as a safety net against any duplicate/stale documents.
        Also clears notifications.
        """
        matching = list(_schedules().find({"user_id": user_id}))
        if not matching:
            return {"error": "Schedule not found or you don't have permission to delete it", "deleted": False}

        result = _delete_many(_schedules(), {"user_id": user_id})
        for sched in matching:
            _delete_many(_activity_logs(), {"schedule_id": sched["schedule_id"]})
        _delete_many(_notifications(), {"user_id": user_id})
        return {"message": "Schedule deleted successfully", "deleted": result.deleted_count > 0}

    def get_schedule(self, user_id: str = None):
        """Get all schedules for a user."""
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

    async def update_schedule(self, schedule_id: str, data: dict) -> dict:
        update_data = {k: v for k, v in data.items() if v is not None}
        update_data["updated_at"] = datetime.utcnow()
        res = _schedules().update_one(
            {"schedule_id": schedule_id},
            {"$set": update_data},
        )
        return {"success": res.matched_count > 0}

    # ====================== ACTIVITY LOGS (read-only here) ======================
    def get_activity_logs(self, user_id: str = None, limit: int = 100):
        """Get activity logs. Logs themselves are written exclusively by
        MonitoringService — this is a read-only view for the dashboard."""
        query = {"user_id": user_id} if user_id else {}
        # Logs are keyed by patient_id in monitoring_service.py — support both.
        if user_id:
            query = {"$or": [{"user_id": user_id}, {"patient_id": user_id}]}
        logs = list(_activity_logs().find(query).sort("created_at", -1).limit(limit))
        for log in logs:
            log["_id"] = str(log["_id"])
            # Serialize datetime fields to ISO strings for JSON compatibility
            for field in ("detected_at", "created_at"):
                if isinstance(log.get(field), datetime):
                    log[field] = log[field].isoformat()
            # Add capitalized display_status so the dashboard can match
            # against "Completed"/"Early"/"Late"/"Missed" labels.
            raw_status = log.get("status", "")
            log["display_status"] = STATUS_TO_DISPLAY.get(
                raw_status, raw_status.title() if raw_status else "Planned"
            )
        return logs

    async def log_deviation(self, schedule_id: str, observed: str, expected: str):
        _deviations().insert_one({
            "schedule_id": schedule_id,
            "observed": observed,
            "expected": expected,
            "created_at": datetime.utcnow(),
        })

    def get_deviations(self, user_id: str = None):
        """Get deviations from schedule."""
        query = {"user_id": user_id} if user_id else {}
        deviations = list(_deviations().find(query).sort("detected_at", -1).limit(50))
        for d in deviations:
            d["_id"] = str(d["_id"])
        return deviations

    # ====================== NOTIFICATIONS ======================
    # NOTE: activity-triggered notifications (late/missed/caregiver_missing)
    # are created by MonitoringService via NotificationService — NOT by this
    # method. This method remains available for any other part of the app
    # that needs to create a one-off notification directly.
    def create_notification(self, user_id: str, activity_name: str, status: str, message: str):
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
        query = {"user_id": user_id} if user_id else {}
        if unread_only:
            query["read"] = False
        notifs = list(_notifications().find(query).sort("created_at", -1).limit(50))
        for n in notifs:
            n["_id"] = str(n["_id"])
        return notifs

    def mark_notification_read(self, notification_id: str):
        result = _notifications().update_one(
            {"notification_id": notification_id},
            {"$set": {"read": True}}
        )
        return {"matched": result.matched_count, "modified": result.modified_count}

    # ====================== REPORTS ======================
    def get_reports(self, user_id: str = None):
        """Get activity reports.

        FIX: stats keys now match monitoring_service.py's canonical lowercase
        vocabulary (done/late/missed/caregiver_missing/pending) instead of
        the old Early/Completed/Late/Missed/Not-Done set, which no longer
        matches anything actually being written to activity_logs.
        """
        logs = self.get_activity_logs(user_id)
        stats = {
            "done": 0,
            "late": 0,
            "missed": 0,
            "caregiver_missing": 0,
            "pending": 0,
            "total": len(logs)
        }
        for log in logs:
            status = log.get("status", "pending")
            if status in stats:
                stats[status] += 1
        return {"stats": stats, "logs": logs}
