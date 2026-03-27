"""
gateway-dashboard/backend/app/routes/gateway_routes.py
"""
from fastapi import APIRouter, Depends
from app.controllers.gateway_controller import (
    get_system_overview,
    get_alerts,
)
from app.middleware.verify_token import get_current_user

router = APIRouter()


@router.get("/overview", summary="System-wide status overview")
async def _overview(user=Depends(get_current_user)):
    return await get_system_overview(user)


@router.get("/alerts", summary="Aggregated alerts from all modules")
async def _alerts(user=Depends(get_current_user)):
    return await get_alerts(user)
