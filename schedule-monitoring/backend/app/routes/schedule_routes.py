"""
schedule-monitoring/backend/app/routes/schedule_routes.py
"""
from fastapi import APIRouter, Depends
from app.controllers.schedule_controller import (
    get_schedule,
    create_schedule,
    get_reports,
    get_deviations,
)
from app.middleware.verify_token import get_current_user

router = APIRouter()


@router.get("/", summary="Get current schedule")
async def _get(user=Depends(get_current_user)):
    return await get_schedule(user)


@router.post("/", summary="Create/update schedule")
async def _create(user=Depends(get_current_user)):
    return await create_schedule(user)


@router.get("/reports", summary="Get activity reports")
async def _reports(user=Depends(get_current_user)):
    return await get_reports(user)


@router.get("/deviations", summary="Get detected deviations")
async def _deviations(user=Depends(get_current_user)):
    return await get_deviations(user)
