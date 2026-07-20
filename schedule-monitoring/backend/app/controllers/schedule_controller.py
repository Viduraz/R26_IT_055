# backend/app/controllers/schedule_controller.py
"""
schedule-monitoring/backend/app/controllers/schedule_controller.py

log_detected_activity() and validate_activity() delegate to
MonitoringService.process_detection_event() — the canonical rule engine
(Early / Completed / Late / Missed).

NOTE: the lowercase→capitalized status dict now lives in monitoring_service.py
as STATUS_TO_DISPLAY, imported here instead of kept as a private copy — see
that file's docstring for why (monitoring_controller.py needed the same
mapping and previously had none at all).
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
    """
    results = monitoring_result.get("results", [])

    if not results:
        return {
            **monitoring_result,
            "status": "Unexpected",
            "adaptive_grace_minutes": EARLY_GRACE_MINUTES,
            "delay_minutes": LATE_THRESHOLD_MINUTES,
            "deadline": None,
        }

    match = results[0]
    lower_status = match.get("status", "")
    display_status = STATUS_TO_DISPLAY.get(lower_status, "Unexpected")

    deadline_iso = None
    start_time = match.get("start_time")
    if start_time:
        h, m = map(int, start_time.split(":"))
        deadline_dt = datetime.now().replace(hour=h, minute=m, second=0, microsecond=0) \
            + timedelta(minutes=LATE_THRESHOLD_MINUTES)
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
    """Get activity logs"""
    return _svc.get_activity_logs(user.get("user_id"))


def get_reports(user: dict):
    """Get activity reports"""
    return _svc.get_reports(user.get("user_id"))


def get_notifications(user: dict, unread_only: bool = False):
    """Get notifications"""
    return _svc.get_notifications(user.get("user_id"), unread_only)


def mark_notification_read(user: dict, notification_id: str):
    """Mark notification as read"""
    return _svc.mark_notification_read(notification_id)


def get_deviations(user: dict):
    """Get deviations"""
    return _svc.get_deviations(user.get("user_id"))