"""
schedule-monitoring/backend/app/routes/schedule_routes.py
Full CRUD for patient schedule items.
"""
from fastapi import APIRouter, Body
from fastapi import APIRouter
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
class SchedulePayload(BaseModel):
    patient_id: str = "patient_001"
    task_name: str
    task_type: str
    start_time: str
    end_time: str
    repeat_days: List[str] = []
    caregiver_required: bool = False
    priority: str = "medium"
    active: bool = True
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
class ScheduleUpdatePayload(BaseModel):
    patient_id: Optional[str] = None
    task_name: Optional[str] = None
    task_type: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    repeat_days: Optional[List[str]] = None
    caregiver_required: Optional[bool] = None
    priority: Optional[str] = None
    active: Optional[bool] = None
@router.get("/reports", summary="Get activity reports")
def _reports():
    """Get statistics of all activities."""
    return get_reports(_user)
@router.get("/deviations", summary="Get schedule deviations")
def _deviations():
    """Get recorded schedule deviations. Previously missing from this
    router even though scheduleApi.js's getDeviations() called it and
    get_deviations() existed in the controller/service — this 404 was
    causing Promise.all() in ScheduleDashboard's fetchData() to reject
    entirely, wiping out the successfully-fetched schedule as well."""
    return get_deviations(_user)
