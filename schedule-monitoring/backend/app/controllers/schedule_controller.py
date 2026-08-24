# backend/app/controllers/schedule_controller.py
"""
schedule-monitoring/backend/app/controllers/schedule_controller.py

log_detected_activity() and validate_activity() delegate to
MonitoringService.process_detection_event() — the canonical rule engine
(Early / Completed / Late / Missed), which now determines Completed vs Late
using each activity's own start_time/end_time boundary rather than a fixed
20-minute cutoff (see monitoring_service.py's docstring).

NOTE: the lowercase→capitalized status dict now lives in monitoring_service.py
as STATUS_TO_DISPLAY, imported here instead of kept as a private copy — see
that file's docstring for why (monitoring_controller.py needed the same
mapping and previously had none at all).

FIX (Dashboard Schedule Sidebar & Detection Status Fix plan) — get_activity_logs()
now auto-triggers MonitoringService.evaluate_missed_tasks() before returning
logs. The dashboard/sidebar polls this endpoint every 5 seconds, so this
ensures any activity whose scheduled window has closed with no detection
gets written to the DB as "Missed" (and locked) on the very next poll,
instead of only being marked missed when something else happened to call
evaluate_missed_tasks() directly.

NEW: get_day_report() and get_week_report() expose the daily_reports
archive (see schedule_service.py's _archive_schedule_as_report /
get_report_by_date / get_reports_for_week) so the frontend Reports page can
show Done/Late/Missed counts for any past day or a 7-day week, not just the
currently-active schedule.

FIX (this revision) — _shape_detection_response() no longer returns the
literal string "Unexpected" for a no-match detection event. See that
function's docstring below for the full reasoning.
"""
from fastapi import HTTPException
from app.services.schedule_service import ScheduleService
from app.services.monitoring_service import (
    MonitoringService,
    EARLY_GRACE_MINUTES,
    LATE_THRESHOLD_MINUTES,
    STATUS_TO_DISPLAY,
)
from datetime import datetime, timedelta

_svc = ScheduleService()
_monitoring = MonitoringService()


def _to_local_naive(dt: datetime) -> datetime:
    """Convert a timezone-aware UTC datetime (from the browser's
    .toISOString()) into a naive local-time datetime, matching the naive
    datetime.now() values used everywhere in monitoring_service.py.
    """
    return dt.astimezone().replace(tzinfo=None)


def _shape_detection_response(monitoring_result: dict) -> dict:
    """Translate MonitoringService's raw {"matched","results"} shape into the
    flat status/adaptive_grace_minutes/delay_minutes/deadline shape the
    frontend actually reads off response.data.

    NOTE: "delay_minutes"/"deadline" here are a legacy display convenience —
    the actual Completed/Late boundary decision now happens inside
    MonitoringService.process_detection_event() using each activity's own
    end_time, not LATE_THRESHOLD_MINUTES. This field is kept only so any
    existing frontend code reading response.data.deadline doesn't break.

    FIX: this used to return "status": "Unexpected" whenever
    process_detection_event() found no matching schedule entry (empty
    results, or a raw status somehow outside STATUS_TO_DISPLAY's keys).
    That's not a real status in the app's vocabulary (Early/Completed/
    Late/Missed) — it was only ever meant as a "no backend match, let the
    frontend decide" signal. Returning it as a literal string meant that if
    the frontend's own fallback logic had any gap, "Unexpected" could leak
    straight onto the screen — which is exactly what happened. Now this
    returns "status": None instead — falsy, so
    ActivityDetectorMonitor.jsx's
    `if (backendStatus && FINAL_STATUSES.includes(backendStatus))` check
    cleanly falls through to its own locally-computed Early/Completed/Late
    every time, with no ambiguous placeholder string in between.
    """
    results = monitoring_result.get("results", [])

    if not results:
        return {
            **monitoring_result,
            "status": None,
            "adaptive_grace_minutes": EARLY_GRACE_MINUTES,
            "delay_minutes": LATE_THRESHOLD_MINUTES,
            "deadline": None,
        }

    match = results[0]
    lower_status = match.get("status", "")
    display_status = STATUS_TO_DISPLAY.get(lower_status)  # None if truly unmapped

    deadline_iso = None
    end_time = match.get("end_time")
    if end_time:
        h, m = map(int, end_time.split(":"))
        deadline_dt = datetime.now().replace(hour=h, minute=m, second=0, microsecond=0)
        deadline_iso = deadline_dt.isoformat()

    return {
        **monitoring_result,
        "status": display_status,
        "adaptive_grace_minutes": EARLY_GRACE_MINUTES,
        "delay_minutes": LATE_THRESHOLD_MINUTES,
        "deadline": deadline_iso,
    }


def get_schedule(user: dict):
    """Get current schedule for the user."""
    # Persist missed activities before ScheduleService checks whether the
    # routine has finished, so the archive contains the final statuses.
    _monitoring.evaluate_missed_tasks(user.get("user_id", "patient_001"))
    return _svc.get_schedule(user.get("user_id"))


def create_schedule(user: dict, payload):
    """Create a new schedule."""
    activities_as_dicts = [
        a.model_dump() if hasattr(a, "model_dump") else dict(a)
        for a in payload.activities
    ]
    return _svc.create_schedule(
        user_id=user.get("user_id", "dev-user"),
        activities=activities_as_dicts,
        description=payload.description
    )


def delete_schedule(user: dict, schedule_id: str):
    """Delete a schedule."""
    return _svc.delete_schedule(user.get("user_id", "dev-user"), schedule_id)


def update_schedule(user: dict, schedule_id: str, data: dict):
    """Update an active schedule without creating an archive entry."""
    return _svc.update_schedule(schedule_id, data)


def log_detected_activity(user: dict, schedule_id: str, payload):
    """Log detected activity.

    Delegates to MonitoringService.process_detection_event() then reshapes
    the response via _shape_detection_response().
    """
    detected_at = payload.detected_at
    if isinstance(detected_at, str):
        detected_at = datetime.fromisoformat(detected_at.replace("Z", "+00:00"))
        detected_at = _to_local_naive(detected_at)

    event = {
        "patient_id": user.get("user_id", "patient_001"),
        "detected_activity": payload.activity_name,
        "confidence": payload.confidence,
        "timestamp": detected_at,
        "caregiver_present": getattr(payload, "caregiver_present", False),
        "caregiver_id": getattr(payload, "caregiver_id", None),
    }
    raw_result = _monitoring.process_detection_event(event)
    return _shape_detection_response(raw_result)


def validate_activity(user: dict, payload: dict):
    """Real-time validation (used by frontend)."""
    try:
        detected_at = datetime.fromisoformat(payload["detected_at"].replace("Z", "+00:00"))
        detected_at = _to_local_naive(detected_at)

        event = {
            "patient_id": user.get("user_id", "patient_001"),
            "detected_activity": payload.get("activity_name", ""),
            "confidence": payload.get("confidence", 0.0),
            "timestamp": detected_at,
            "caregiver_present": payload.get("caregiver_present", False),
            "caregiver_id": payload.get("caregiver_id"),
        }
        raw_result = _monitoring.process_detection_event(event)
        return _shape_detection_response(raw_result)
    except Exception as e:
        return {"error": f"Validation failed: {str(e)}"}


def get_activity_logs(user: dict):
    """Get activity logs.

    FIX: auto-trigger evaluate_missed_tasks() first. The dashboard/sidebar
    polls this endpoint every 5 seconds, so this write-through ensures any
    activity whose window has closed with no detection is marked "Missed"
    (and persisted/locked) on the very next poll cycle.
    """
    _monitoring.evaluate_missed_tasks(user.get("user_id", "patient_001"))
    return _svc.get_activity_logs(user.get("user_id"))


def get_reports(user: dict):
    """Get activity reports for the CURRENTLY ACTIVE schedule (today, in
    progress). For past archived days, use get_day_report / get_week_report
    below."""
    return _svc.get_reports(user.get("user_id"))


def get_day_report(user: dict, date: str):
    """Get the archived Done/Late/Missed/Total counts for one specific
    calendar day (YYYY-MM-DD), e.g. Monday's finished routine."""
    _monitoring.evaluate_missed_tasks(user.get("user_id", "patient_001"))
    _svc._expire_finished_or_stale_schedules(user.get("user_id"))
    user_id = user.get("user_id")
    report = _svc.get_report_by_date(user_id, date)
    return report or _svc.get_current_day_report(user_id, date)


def get_week_report(user: dict, start_date: str):
    """Get 7 days of archived reports plus summed weekly totals,
    starting at start_date (YYYY-MM-DD)."""
    _monitoring.evaluate_missed_tasks(user.get("user_id", "patient_001"))
    _svc._expire_finished_or_stale_schedules(user.get("user_id"))
    return _svc.get_reports_for_week(user.get("user_id"), start_date)


def get_notifications(user: dict, unread_only: bool = False):
    """Get notifications"""
    return _svc.get_notifications(user.get("user_id"), unread_only)


def mark_notification_read(user: dict, notification_id: str):
    """Mark notification as read"""
    return _svc.mark_notification_read(notification_id)


def get_deviations(user: dict):
    """Get deviations"""
    return _svc.get_deviations(user.get("user_id"))