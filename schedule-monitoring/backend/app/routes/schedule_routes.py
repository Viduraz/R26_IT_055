"""
schedule-monitoring/backend/app/routes/schedule_routes.py
Full CRUD for patient schedule items.

⚠️ ACTION NEEDED — I haven't seen app/controllers/schedule_controller.py yet.
The two corrected service files (monitoring_service_CORRECTED.py,
schedule_service_CORRECTED.py) REMOVED these ScheduleService methods, since
they duplicated status logic that now lives solely in MonitoringService:
    - log_activity_detection()
    - check_activity_status()
    - get_adaptive_grace_period()
    - check_missed_activities()

If schedule_controller.py's `log_detected_activity` or `validate_activity`
functions call any of the above on a ScheduleService instance, they will now
raise AttributeError. Please share schedule_controller.py so I can point
those functions at MonitoringService.process_detection_event() /
evaluate_missed_tasks() instead — I don't want to guess at that file's
internals and hand you something that silently breaks in a different way.

Everything else below (CRUD, notifications, reports, deviations routes) only
touches ScheduleService methods that are unchanged, so those are safe as-is.
"""
from fastapi import APIRouter, Body
from typing import List, Optional
from pydantic import BaseModel
from app.controllers.schedule_controller import (
    get_schedule,
    create_schedule,
    delete_schedule,
    get_reports,
    get_deviations,
    get_activity_logs,
    log_detected_activity,
    get_notifications,
    mark_notification_read,
    validate_activity,
)
from app.schemas.schedule_schema import CreateScheduleSchema, ActivityDetectionSchema

router = APIRouter()

# Development: Removed authentication temporarily
_user = {"user_id": "patient_001"}


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
    """Called by frontend ML vision module when activity is detected.

    ⚠️ See module docstring — schedule_controller.log_detected_activity must
    now call MonitoringService.process_detection_event(), not the removed
    ScheduleService.log_activity_detection().
    """
    return log_detected_activity(_user, schedule_id, payload)


@router.post("/validate", summary="Validate activity with adaptive thresholds")
def _validate(payload: dict = Body(...)):
    """Real-time adaptive validation (used by frontend).

    ⚠️ See module docstring — schedule_controller.validate_activity must be
    updated since ScheduleService.check_activity_status() /
    get_adaptive_grace_period() were removed.
    """
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


@router.get("/deviations", summary="Get schedule deviations")
def _deviations():
    """Get recorded schedule deviations."""
    return get_deviations(_user)
