"""
schedule-monitoring/backend/app/routes/schedule_routes.py
"""
from fastapi import APIRouter, Body
from app.controllers.schedule_controller import (
    get_schedule,
    create_schedule,
    get_reports,
    get_deviations,
    get_activity_logs,
    log_detected_activity,
    get_notifications,
    mark_notification_read,
    validate_activity,
    delete_schedule
)
from app.schemas.schedule_schema import CreateScheduleSchema, ActivityDetectionSchema

router = APIRouter()

# Development: Removed authentication temporarily
_user = {"user_id": "dev-user"}


@router.get("/", summary="Get current schedule")
def _get():
    """Retrieve the current schedule with all activities."""
    return get_schedule(_user)


@router.post("/", summary="Create/update schedule")
def _create(payload: CreateScheduleSchema = Body(...)):
    """Create a new schedule with activities and time ranges."""
    return create_schedule(_user, payload)


@router.delete("/{schedule_id}", summary="Delete schedule")
def _delete(schedule_id: str):
    """Delete a specific schedule."""
    return delete_schedule(_user, schedule_id)


@router.get("/logs", summary="Get activity logs")
def _logs():
    """Retrieve all activity detection logs."""
    return get_activity_logs(_user)


@router.post("/logs/{schedule_id}/detect", summary="Log detected activity")
def _log_activity(schedule_id: str, payload: ActivityDetectionSchema = Body(...)):
    """Called by frontend ML vision module when activity is detected."""
    return log_detected_activity(_user, schedule_id, payload)


@router.post("/validate", summary="Validate activity with adaptive thresholds")
def _validate(payload: dict = Body(...)):
    """New endpoint: Real-time adaptive validation (used by frontend)"""
    return validate_activity(_user, payload)


@router.get("/notifications", summary="Get notifications")
def _notifications(unread_only: bool = False):
    """Retrieve all Late/Missed notifications."""
    return get_notifications(_user, unread_only)


@router.post("/notifications/{notification_id}/read", summary="Mark notification as read")
def _mark_read(notification_id: str):
    """Mark a specific notification as read."""
    return mark_notification_read(_user, notification_id)


@router.get("/reports", summary="Get activity reports")
def _reports():
    """Get statistics of all activities."""
    return get_reports(_user)


@router.get("/deviations", summary="Get detected deviations")
def _deviations():
    """Get all activity mismatches."""
    return get_deviations(_user)


@router.get("/debug-db", summary="Debug database state")
def _debug_db():
    """Retrieve full mock database state for debugging."""
    from shared.backend.config.database import _mock_collections, _mongo_failed
    return {
        "database_type": "Mock In-Memory DB (Fallback Active)" if _mongo_failed else "Real MongoDB Connection",
        "schedules": _mock_collections.get("schedules", []),
        "activity_logs": _mock_collections.get("activity_logs", []),
        "notifications": _mock_collections.get("notifications", []),
        "deviations": _mock_collections.get("deviations", [])
    }