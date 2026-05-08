"""
schedule-monitoring/backend/app/routes/schedule_routes.py
Full CRUD for patient schedule items.
"""
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
)

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


@router.get("/", summary="Get all schedule items")
async def _get_all():
    return await get_all_schedules(_DUMMY_USER)


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
