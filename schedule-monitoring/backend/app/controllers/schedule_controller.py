"""
schedule-monitoring/backend/app/controllers/schedule_controller.py
"""
from fastapi import HTTPException
from app.services.schedule_service import ScheduleService

_svc = ScheduleService()


async def get_all_schedules(user: dict):
    return await _svc.get_all_schedules()


async def get_schedule(user: dict):
    return await _svc.get_all_schedules()


async def get_schedules_by_patient(patient_id: str, user: dict):
    return await _svc.get_schedules_by_patient(patient_id)


async def create_schedule(data: dict, user: dict):
    return await _svc.create_schedule(data)


async def update_schedule(schedule_id: str, data: dict, user: dict):
    result = await _svc.update_schedule(schedule_id, data)
    if not result.get("success"):
        raise HTTPException(status_code=404, detail="Schedule not found")
    return result


async def delete_schedule(schedule_id: str, user: dict):
    result = await _svc.delete_schedule(schedule_id)
    if not result.get("success"):
        raise HTTPException(status_code=404, detail="Schedule not found")
    return result


async def get_reports(user: dict):
    return await _svc.get_reports()


async def get_deviations(user: dict):
    return await _svc.get_deviations()
