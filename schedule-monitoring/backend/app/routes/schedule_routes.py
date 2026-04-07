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
)
from app.schemas.schedule_schema import CreateScheduleSchema, ActivityDetectionSchema

router = APIRouter()

# Development: Removed authentication temporarily
_user = {"user_id": "dev-user"}


@router.get("/", summary="Get current schedule")
async def _get():
    """Retrieve the current schedule with all activities."""
    return await get_schedule(_user)


@router.post("/", summary="Create/update schedule")
async def _create(payload: CreateScheduleSchema = Body(...)):
    """Create a new schedule with activities and time ranges."""
    return await create_schedule(_user, payload)


@router.get("/logs", summary="Get activity logs")
async def _logs():
    """Retrieve all activity detection logs with status (Done/Late/Missed)."""
    return await get_activity_logs(_user)


@router.post("/logs/{schedule_id}/detect", summary="Log detected activity")
async def _log_activity(schedule_id: str, payload: ActivityDetectionSchema = Body(...)):
    """
    Called by vision module when an activity is detected.
    Validates against 20-minute rule automatically.
    """
    return await log_detected_activity(_user, schedule_id, payload)


@router.get("/notifications", summary="Get notifications")
async def _notifications(unread_only: bool = False):
    """Retrieve all Late/Missed notifications for the owner."""
    return await get_notifications(_user, unread_only)


@router.post("/notifications/{notification_id}/read", summary="Mark notification as read")
async def _mark_read(notification_id: str):
    """Mark a specific notification as read."""
    return await mark_notification_read(_user, notification_id)


@router.get("/reports", summary="Get activity reports")
async def _reports():
    """Get statistics of all activities (Done/Late/Missed counts)."""
    return await get_reports(_user)


@router.get("/deviations", summary="Get detected deviations")
async def _deviations():
    """Get all activity mismatches (unexpected activities detected)."""
    return await get_deviations(_user)
