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
  - get_adaptive_grace_period() / check_activity_status()
  - log_activity_detection()
  - check_missed_activities()

DAILY REPORT ARCHIVING (added previously):
Each user has exactly ONE active schedule at a time. Every schedule is
stamped with a "date" (the calendar day it belongs to) when created, and
gets archived before being replaced.

NEW FIX (this revision) — two bugs reported by Nethmi:

BUG 1 — orphaned schedule survives "delete":
schedule_routes.py hardcodes `_user = {"user_id": "patient_001"}` for every
request (there's no real multi-user auth in this app — it's a single-
patient system). But delete_schedule()/create_schedule() previously scoped
their queries to `{"user_id": user_id}`. A document was found in the real
DB with "user_id": "dev-user" (leftover from an earlier test run, before
`_user` was hardcoded) — every user_id-scoped query silently skips it
forever, since it never matches "patient_001". Clicking "delete" in the UI
therefore never touched it.

FIX: since this app only ever has ONE real active schedule regardless of
which user_id string got stamped on it, delete_schedule() and
create_schedule() now operate on the schedules collection as a SINGLETON —
they no longer filter by user_id at all when locating what to remove. This
makes "delete" actually delete everything, and closes the door on this bug
recurring from any future user_id mismatch.

BUG 2 — stale schedule doesn't clear itself for a new day:
Previously, an old schedule only got archived+removed at the moment you
manually created a NEW one. So if you finished Monday's routine and just
opened the dashboard on Tuesday without creating a new schedule first,
Tuesday's dashboard would still show Monday's stale schedule.

FIX: get_schedule() now calls _expire_stale_schedules_if_new_day() on every
call. Any schedule whose date is not today gets auto-archived into
daily_archives and deleted, BEFORE the schedule list is returned. This means
simply opening the dashboard on a new day is enough to get a clean slate —
you don't have to remember to create a new schedule to trigger the
rollover.

COLLECTION RENAME: the archive collection is now `daily_archives` (matches
the collection name already present in the project's real MongoDB schema),
instead of a new "daily_reports" collection invented in an earlier revision.
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


# ── Timing config ────────────────────────────────────────────────────────
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


def _date_of(schedule: dict) -> str | None:
    """Get the calendar day (YYYY-MM-DD) a schedule document belongs to.

    Newer documents have an explicit "date" field. Older documents (created
    before that field existed — like the orphaned "dev-user" one found in
    the DB) don't have it, so we fall back to created_at so they don't
    linger forever uncleaned.
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

        Treats `schedules` as a SINGLETON collection (see module docstring,
        BUG 1): finds and archives/deletes ALL existing schedule documents,
        not just ones matching this user_id, so a stray user_id can never
        create an orphan again. Also runs the day-rollover expiry check
        first, so anything already stale gets cleaned up the same way.
        """
        self._expire_stale_schedules_if_new_day(user_id)

        existing = list(_schedules().find({}))  # ALL schedules, not user_id-scoped
        for old in existing:
            self._archive_schedule_as_report(old.get("user_id") or user_id, old)

        for old in existing:
            _delete_many(_activity_logs(), {"schedule_id": old["schedule_id"]})
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

        FIX (BUG 1): previously scoped to `{"user_id": user_id}`, which
        silently failed to delete any document stamped with a different
        user_id (e.g. the "dev-user" orphan). Since this app only ever has
        one real active schedule, this now wipes ALL schedule documents,
        regardless of user_id, so "delete" always actually deletes.

        NOTE: an explicit delete does NOT archive to daily_archives first —
        this is treated as "throw this away", not "the day finished". Day
        completion archiving happens automatically via
        _expire_stale_schedules_if_new_day() / create_schedule() instead.
        """
        matching = list(_schedules().find({}))
        if not matching:
            return {"error": "No schedule found to delete", "deleted": False}

        result = _delete_many(_schedules(), {})
        for sched in matching:
            _delete_many(_activity_logs(), {"schedule_id": sched["schedule_id"]})
        _delete_many(_notifications(), {})
        return {"message": "Schedule deleted successfully", "deleted": result.deleted_count > 0}

    def get_schedule(self, user_id: str = None):
        """Get all schedules for a user.

        NEW (BUG 2 fix): runs the day-rollover check FIRST. If the active
        schedule belongs to a day before today, it gets archived into
        daily_archives and deleted right here — before this function
        returns anything. So opening the dashboard on a new day, with no
        manual action taken, is enough to see a clean "no active routine"
        state.
        """
        self._expire_stale_schedules_if_new_day(user_id)

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
        """Snapshot an ending day's schedule + logs into daily_archives
        BEFORE it gets deleted (called from create_schedule(),
        delete_schedule()'s sibling expiry check, or
        _expire_stale_schedules_if_new_day()).

        Safe to call even if the old schedule has zero logs — counts will
        just come out all zero, and we still record that the day happened.
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

    def _expire_stale_schedules_if_new_day(self, user_id: str = None):
        """NEW: auto-archive + delete any schedule whose date is before
        today. Called at the top of get_schedule() (and again defensively
        inside create_schedule()) so a new calendar day always starts with
        a clean slate — no manual action required.

        Checks ALL schedule documents, not just ones matching a specific
        user_id (see module docstring, BUG 1) — this is also what silently
        cleans up any orphaned document like the "dev-user" one, since its
        created_at (2026-07-14) will always be "before today" from now on.
        """
        today_str = _local_now().strftime("%Y-%m-%d")
        all_schedules = list(_schedules().find({}))

        for sched in all_schedules:
            sched_date = _date_of(sched)
            if sched_date and sched_date != today_str:
                owner = sched.get("user_id") or user_id
                self._archive_schedule_as_report(owner, sched)
                _delete_many(_activity_logs(), {"schedule_id": sched.get("schedule_id")})
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