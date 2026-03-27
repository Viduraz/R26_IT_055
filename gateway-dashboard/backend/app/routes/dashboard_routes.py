"""
gateway-dashboard/backend/app/routes/dashboard_routes.py
API Routing for the Gateway Dashboard
"""
from fastapi import APIRouter
from app.controllers.dashboard_controller import (
    get_admin_summary,
    get_caregiver_profile,
    get_family_alerts,
    get_caregiver_status_global,
    get_global_alerts
)

router = APIRouter()

router.get("/admin/summary", summary="Get Admin Dashboard Data", response_model=dict)(get_admin_summary)
router.get("/caregiver/profile", summary="Get Caregiver Dashboard Data", response_model=dict)(get_caregiver_profile)
router.get("/family/alerts", summary="Get Family Dashboard Data", response_model=dict)(get_family_alerts)
router.get("/caregiver-status", summary="Get live tracking sessions", response_model=dict)(get_caregiver_status_global)
router.get("/alerts", summary="Get system-wide absence alerts", response_model=dict)(get_global_alerts)
