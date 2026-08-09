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
the vocabulary it was written to filter for.

monitoring_service.py is now the single canonical engine for detection
status and the 20-minute rule. This file is CRUD-only.

REMOVED from this file (now dead, superseded by monitoring_service.py):
  - get_adaptive_grace_period() / check_activity_status()
  - log_activity_detection()
  - check_missed_activities()

DAILY REPORT ARCHIVING:
Each user has exactly ONE active schedule at a time. Every schedule is
stamped with a "date" (the calendar day it belongs to) when created, and
gets archived into `daily_archives` before being replaced.

BUG 1 FIX (orphaned schedule survives "delete") — schedule_routes.py
hardcodes `_user = {"user_id": "patient_001"}` for every request (no real
multi-user auth here — single-patient system). delete_schedule() and
create_schedule() now treat `schedules` as a SINGLETON collection: they
locate/remove ALL schedule documents regardless of user_id, so a stray
user_id (like an old "dev-user" orphan) can never survive a delete or
linger forever again.

BUG 2 FIX (stale schedule doesn't clear itself) — originally, an old
schedule only got archived+removed when a calendar day rolled over, OR when
you manually created a new one. That's too coarse for two real cases:

  (a) Calendar-day rollover: opening the dashboard on a NEW day should show
      a clean slate without you having to manually create anything.
  (b) FINISHED-TODAY rollover (NEW in this revision): with TESTING_MODE on,
      a schedule's activities can all finish their windows within minutes —
      long before midnight. The schedule should disappear from the
      dashboard and land in daily_archives as soon as the LAST activity's
      end_time has passed, not just at the next calendar day.

_expire_finished_or_stale_schedules() now checks BOTH conditions every time
get_schedule() is called: it retires a schedule if it belongs to a past day
OR if today's schedule has already run past its last activity's end_time.
Either way, the guardian can immediately pick a fresh schedule afterward.
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


def _archives():
    """Archived per-day reports. Uses the `daily_archives` collection name
    that already exists in the project's real MongoDB schema."""
    return get_db()["daily_archives"]


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


def _delete_logs_for_schedule(base_schedule_id: str):
    """FIX: delete all activity_logs tied to a schedule, correctly.

    monitoring_service.py's _active_schedules() stores each activity's logs
    under a COMPOSITE schedule_id of the form "{base_schedule_id}::{index}"
    (e.g. "abc123::0", "abc123::1") — one per activity — NOT the plain
    schedule UUID stored on the schedule document itself. Every previous
    call site in this file did `_delete_many(_activity_logs(),
    {"schedule_id": old["schedule_id"]})`, which only ever matches the
    plain UUID and therefore matched NOTHING — logs from every schedule
    ever created just piled up forever, never actually deleted.

    Symptom this caused: create a new routine reusing an activity name from
    an earlier (already-finished/expired) schedule — e.g. "Sleeping" again —
    and ScheduleDashboard.jsx's activity_name + date matching would
    immediately pick up the OLD, never-deleted "Missed" log and show it as
    already Missed, before the new schedule's window had even opened.

    Fetch all logs and filter for an exact match OR a "{base}::" prefix
    match in Python (the mock DB doesn't support regex/prefix queries
    either), then delete each matching schedule_id individually.
    """
    if not base_schedule_id:
        return
    all_logs = list(_activity_logs().find({}))
    matching_ids = {
        log.get("schedule_id")
        for log in all_logs
        if log.get("schedule_id") == base_schedule_id
        or (log.get("schedule_id") or "").startswith(f"{base_schedule_id}::")
    }
    for sid in matching_ids:
        _delete_many(_activity_logs(), {"schedule_id": sid})


# ── Timing config ────────────────────────────────────────────────────────
# Set TESTING_MODE = True only while you want fast demo timing (e.g. showing
# your leader a Late/Missed notification within minutes instead of waiting
# for a real 8am slot). Set it to False for real usage — real start_time/
# end_time from the owner's input will then be preserved untouched.
TESTING_MODE = True

# FIX: was DURATION_MINUTES=3.0 / START_OFFSET_MINUTES=2.0 — the entire
# schedule (across all activities) closed within ~9-11 minutes of creation,
# which is barely enough time to read the dashboard, let alone click "Start
# Live Tracking" and let the camera actually observe each activity. The
# background missed-sweep isn't buggy — it correctly marks an activity
# Missed once its window closes with no detection, REGARDLESS of whether the
# camera was ever turned on. Widened so each activity gets a realistic
# window to actually demo detection in, not just to prove the sweep works.
TIMING_CONFIG = {
    "DURATION_MINUTES": 10.0,
    "START_OFFSET_MINUTES": 5.0,
}


def _local_now() -> datetime:
    return datetime.now()


def _date_of(schedule: dict) -> str | None:
    """Get the calendar day (YYYY-MM-DD) a schedule document belongs to.

    Newer documents have an explicit "date" field. Older documents (created
    before that field existed) fall back to created_at so they don't linger
    forever uncleaned.
    """
    date_str = schedule.get("date")
    if date_str:
        return date_str

    created = schedule.get("created_at")
    if isinstance(created, datetime):
        return created.strftime("%Y-%m-%d")
    if isinstance(created, str) and len(created) >= 10:
        return created[:10]
    return None


def _last_activity_end_time(schedule: dict) -> tuple[int, int] | None:
    """Parse every activity's end_time ("HH:MM") and return the LATEST one
    as (hour, minute), so we know when the whole schedule finishes.
    Returns None if there are no activities or no parseable end_times.
    """
    end_times = []
    for activity in schedule.get("activities") or []:
        end_time = activity.get("end_time") if isinstance(activity, dict) else None
        if not end_time:
            continue
        try:
            h, m = map(int, end_time.split(":"))
            end_times.append((h, m))
        except (ValueError, AttributeError):
            continue
    return max(end_times) if end_times else None


def _is_finished_today(schedule: dict) -> bool:
    """True if the current local time is already past this schedule's last
    activity's end_time (only meaningful for a schedule dated today —
    schedules from a past day are already caught by the date check).
    """
    last_end = _last_activity_end_time(schedule)
    if not last_end:
        return False
    h, m = last_end
    now = _local_now()
    last_end_dt = now.replace(hour=h, minute=m, second=0, microsecond=0)
    return now > last_end_dt


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

        Treats `schedules` as a SINGLETON collection: archives/deletes ALL
        existing schedule documents, not just ones matching this user_id.
        Also runs the finished-or-stale expiry check first, so anything
        already done gets cleaned up the same way.
        """
        self._expire_finished_or_stale_schedules(user_id)

        existing = list(_schedules().find({}))  # ALL schedules, not user_id-scoped
        for old in existing:
            self._archive_schedule_as_report(old.get("user_id") or user_id, old)

        for old in existing:
            _delete_logs_for_schedule(old["schedule_id"])
        _delete_many(_notifications(), {})
        _delete_many(_schedules(), {})

        schedule_id = str(uuid.uuid4())
        normalized_activities = _normalize_schedule_activities(activities)
        schedule = {
            "schedule_id": schedule_id,
            "user_id": user_id,
            "patient_id": user_id,
            "date": _local_now().strftime("%Y-%m-%d"),
            "activities": normalized_activities,
            "description": description or "",
            "created_at": _local_now(),
            "updated_at": _local_now()
        }
        result = _schedules().insert_one(schedule)
        schedule["_id"] = str(result.inserted_id)
        return schedule

    def delete_schedule(self, user_id: str, schedule_id: str):
        """Delete the active schedule and all associated logs/notifications.

        Wipes ALL schedule documents regardless of user_id (see module
        docstring, BUG 1), so "delete" always actually deletes. This is an
        explicit "throw this away" action — it does NOT archive to
        daily_archives first. Day/schedule completion archiving happens
        automatically via _expire_finished_or_stale_schedules() /
        create_schedule() instead.
        """
        matching = list(_schedules().find({}))
        if not matching:
            return {"error": "No schedule found to delete", "deleted": False}

        result = _delete_many(_schedules(), {})
        for sched in matching:
            _delete_logs_for_schedule(sched["schedule_id"])
        _delete_many(_notifications(), {})
        return {"message": "Schedule deleted successfully", "deleted": result.deleted_count > 0}

    def get_schedule(self, user_id: str = None):
        """Get all schedules for a user.

        Runs the finished-or-stale expiry check FIRST. A schedule gets
        auto-archived into daily_archives and deleted right here — before
        this function returns anything — if EITHER:
          (a) it belongs to a day before today, OR
          (b) today's schedule has already run past its last activity's
              end_time (NEW — this is what makes fast TESTING_MODE routines
              disappear and land in reports within minutes, not only at
              midnight).
        """
        self._expire_finished_or_stale_schedules(user_id)

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
        if user_id:
            query = {"$or": [{"user_id": user_id}, {"patient_id": user_id}]}
        logs = list(_activity_logs().find(query).sort("created_at", -1).limit(limit))
        for log in logs:
            log["_id"] = str(log["_id"])
            for field in ("detected_at", "created_at"):
                if isinstance(log.get(field), datetime):
                    log[field] = log[field].isoformat()
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

    # ====================== REPORTS (live, current schedule) ======================
    def get_reports(self, user_id: str = None):
        """Get activity reports FOR THE CURRENTLY ACTIVE schedule (today,
        in progress). For PAST days already archived, use
        get_report_by_date() / get_reports_for_week() below."""
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

    # ====================== DAILY REPORT ARCHIVING ======================
    def _archive_schedule_as_report(self, user_id: str, old_schedule: dict):
        """Snapshot an ending schedule + logs into daily_archives BEFORE it
        gets deleted. Safe to call even with zero logs — counts will just
        come out all zero, and we still record that the day happened.
        """
        logs = self.get_activity_logs(user_id)
        counts = {
            "done": 0,
            "late": 0,
            "missed": 0,
            "caregiver_missing": 0,
            "pending": 0,
            "total": len(logs),
        }
        for log in logs:
            status = log.get("status", "pending")
            if status in counts:
                counts[status] += 1

        report_date = _date_of(old_schedule) or _local_now().strftime("%Y-%m-%d")

        report_doc = {
            "report_id": str(uuid.uuid4()),
            "user_id": user_id,
            "date": report_date,
            "schedule_id": old_schedule.get("schedule_id"),
            "activities": logs,
            "counts": counts,
            "created_at": _local_now(),
        }
        _archives().insert_one(report_doc)
        return report_doc

    def _expire_finished_or_stale_schedules(self, user_id: str = None):
        """Auto-archive + delete any schedule that is DONE, meaning either:
          (a) it belongs to a calendar day before today, or
          (b) it's today's schedule, but the current time is already past
              its last activity's end_time (NEW — see module docstring).

        Called at the top of get_schedule() (and again defensively inside
        create_schedule()). Checks ALL schedule documents, not just ones
        matching a specific user_id, which also cleans up any orphaned
        document with a mismatched user_id.
        """
        today_str = _local_now().strftime("%Y-%m-%d")
        all_schedules = list(_schedules().find({}))

        for sched in all_schedules:
            sched_date = _date_of(sched)
            is_past_day = bool(sched_date) and sched_date != today_str
            is_finished_today = (sched_date == today_str) and _is_finished_today(sched)

            if is_past_day or is_finished_today:
                owner = sched.get("user_id") or user_id
                self._archive_schedule_as_report(owner, sched)
                _delete_logs_for_schedule(sched.get("schedule_id"))
                _delete_many(_notifications(), {"user_id": owner})
                _delete_many(_schedules(), {"schedule_id": sched.get("schedule_id")})

    def get_report_by_date(self, user_id: str, date: str):
        """Fetch the archived report for one calendar day, e.g. '2026-07-21'."""
        all_reports = list(_archives().find({"user_id": user_id}))
        matches = [r for r in all_reports if r.get("date") == date]
        if not matches:
            return None
        report = matches[-1]
        report["_id"] = str(report["_id"])
        return report

    def get_reports_for_week(self, user_id: str, start_date: str):
        """Fetch 7 days of archived reports starting at start_date
        ('YYYY-MM-DD') and sum them into weekly totals."""
        start = datetime.strptime(start_date, "%Y-%m-%d")
        week_dates = [(start + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(7)]

        all_reports = list(_archives().find({"user_id": user_id}))
        by_date = {r.get("date"): r for r in all_reports}

        daily_reports = []
        weekly_totals = {"done": 0, "late": 0, "missed": 0, "caregiver_missing": 0, "pending": 0, "total": 0}

        for d in week_dates:
            report = by_date.get(d)
            if report:
                report["_id"] = str(report["_id"])
                daily_reports.append(report)
                for key in weekly_totals:
                    weekly_totals[key] += report["counts"].get(key, 0)
            else:
                daily_reports.append({"date": d, "counts": None, "activities": []})

        return {
            "start_date": start_date,
            "daily_reports": daily_reports,
            "weekly_totals": weekly_totals,
        }