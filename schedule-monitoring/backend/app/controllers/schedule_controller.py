"""
schedule-monitoring/backend/app/controllers/schedule_controller.py
"""
from app.services.schedule_service import ScheduleService

_svc = ScheduleService()


async def get_schedule(user: dict):
    return await _svc.get_schedule()


async def create_schedule(user: dict):
    # TODO: accept schedule payload from body
    return {"message": "TODO: accept and save schedule"}


async def get_reports(user: dict):
    return await _svc.get_reports()


async def get_deviations(user: dict):
    return await _svc.get_deviations()
