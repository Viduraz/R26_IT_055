"""
schedule-monitoring/backend/app/routes/schedule_routes.py
Full CRUD for patient schedule items.
"""

from fastapi import APIRouter, Body

from fastapi import APIRouter
from typing import List, Optional
from pydantic import BaseModel

from app.controllers.schedule_controller import (
    get_all_schedules,
    get_schedules_by_patient,
    create_schedule,
    update_schedule,
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


router = APIRouter()

_DUMMY_USER = {}   # auth guard disabled — will be re-enabled later



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



@router.get("/", summary="Get all schedule items")
async def _get_all():
    return await get_all_schedules(_DUMMY_USER)


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


@router.get("/patient/{patient_id}", summary="Get schedules for a patient")
async def _get_by_patient(patient_id: str):
    return await get_schedules_by_patient(patient_id, _DUMMY_USER)


@router.post("/", summary="Create a schedule item")
async def _create(payload: SchedulePayload):
    return await create_schedule(payload.model_dump(), _DUMMY_USER)


@router.put("/{schedule_id}", summary="Update a schedule item")
async def _update(schedule_id: str, payload: ScheduleUpdatePayload):
    data = {k: v for k, v in payload.model_dump().items() if v is not None}
    return await update_schedule(schedule_id, data, _DUMMY_USER)


@router.delete("/{schedule_id}", summary="Delete a schedule item")
async def _delete(schedule_id: str):
    return await delete_schedule(schedule_id, _DUMMY_USER)


@router.get("/reports", summary="Get legacy activity reports")
async def _reports():
    return await get_reports(_DUMMY_USER)


@router.get("/deviations", summary="Get legacy deviations")
async def _deviations():
    return await get_deviations(_DUMMY_USER)
