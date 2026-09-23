"""
schedule-monitoring/backend/app/routes/schedule_routes.py
Full CRUD for patient schedule items.

NEW: /reports/day/{date} and /reports/week routes expose the daily_reports
archive created by schedule_service.py's _archive_schedule_as_report(), so
the frontend can show Done/Late/Missed counts for any past day or a 7-day
week — not just the currently-active schedule (which /reports still covers).
"""
from fastapi import APIRouter, Body, Depends
from typing import List, Optional
from pydantic import BaseModel
from app.controllers.schedule_controller import (
    get_schedule,
    create_schedule,
    delete_schedule,
    update_schedule,
    get_reports,
    get_day_report,
    get_week_report,
    get_deviations,
    get_activity_logs,
    log_detected_activity,
    get_notifications,
    mark_notification_read,
    validate_activity,
)
from app.schemas.schedule_schema import CreateScheduleSchema, ActivityDetectionSchema
from app.middleware.verify_token import get_current_user

router = APIRouter()


@router.get("/", summary="Get current schedule")
def _get(user: dict = Depends(get_current_user)):
    """Retrieve the current schedule with all activities."""
    return get_schedule(user)


@router.post("/", summary="Create/update schedule")
def _create(payload: CreateScheduleSchema = Body(...), user: dict = Depends(get_current_user)):
    """Create a new schedule with activities and time ranges."""
    return create_schedule(user, payload)


@router.delete("/{schedule_id}", summary="Delete schedule")
def _delete(schedule_id: str, user: dict = Depends(get_current_user)):
    """Delete a specific schedule."""
    return delete_schedule(_user, schedule_id)
@router.put("/{schedule_id}", summary="Update schedule")
def _update(schedule_id: str, payload: dict = Body(...)):
    """Update the active schedule without archiving the previous version."""
    return update_schedule(_user, schedule_id, payload)
@router.get("/logs", summary="Get activity logs")
def _logs(user: dict = Depends(get_current_user)):
    """Retrieve all activity detection logs."""
    return get_activity_logs(user)


@router.post("/logs/{schedule_id}/detect", summary="Log detected activity")
def _log_activity(schedule_id: str, payload: ActivityDetectionSchema = Body(...), user: dict = Depends(get_current_user)):
    """Called by frontend ML vision module when activity is detected."""
    return log_detected_activity(user, schedule_id, payload)


@router.post("/validate", summary="Validate activity with adaptive thresholds")
def _validate(payload: dict = Body(...), user: dict = Depends(get_current_user)):
    """Real-time adaptive validation (used by frontend)."""
    return validate_activity(user, payload)


@router.get("/notifications", summary="Get notifications")
def _notifications(unread_only: bool = False, user: dict = Depends(get_current_user)):
    """Retrieve all Late/Missed notifications."""
    return get_notifications(user, unread_only)


@router.post("/notifications/{notification_id}/read", summary="Mark notification as read")
def _mark_read(notification_id: str, user: dict = Depends(get_current_user)):
    """Mark a specific notification as read."""
    return mark_notification_read(user, notification_id)


@router.get("/reports", summary="Get activity reports")
def _reports(user: dict = Depends(get_current_user)):
    """Get statistics of all activities for the CURRENTLY ACTIVE schedule
    (today, in progress)."""
    return get_reports(user)


@router.get("/reports/day/{date}", summary="Get archived report for one day")
def _day_report(date: str, user: dict = Depends(get_current_user)):
    """Get the archived Done/Late/Missed counts for one calendar day.
    date format: YYYY-MM-DD, e.g. 2026-07-21."""
    return get_day_report(user, date)


@router.get("/reports/week", summary="Get archived reports for a 7-day week")
def _week_report(start_date: str, user: dict = Depends(get_current_user)):
    """Get per-day reports + weekly totals for the 7 days starting at
    start_date. start_date format: YYYY-MM-DD.
    Example: GET /api/schedule/reports/week?start_date=2026-07-20"""
    return get_week_report(user, start_date)


@router.get("/deviations", summary="Get schedule deviations")
def _deviations(user: dict = Depends(get_current_user)):
    """Get recorded schedule deviations."""
    return get_deviations(user)
