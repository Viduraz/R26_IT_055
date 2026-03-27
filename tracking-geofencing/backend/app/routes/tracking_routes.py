"""
tracking-geofencing/backend/app/routes/tracking_routes.py
"""
from fastapi import APIRouter, Depends
from app.controllers.tracking_controller import (
    run_tracking,
    manage_zones,
    get_tracking_history,
    start_caregiver_session,
    update_caregiver_visibility,
    get_caregiver_status
)
from app.middleware.verify_token import get_current_user
from app.schemas.tracking_schema import SessionHandoffRequest, TrackVisibilityRequest

router = APIRouter()

router.post("/start-caregiver-session", summary="Accept session handoff from Face ML")(start_caregiver_session)
router.post("/update-caregiver-visibility", summary="Analyze live webcam skeleton frame")(update_caregiver_visibility)
router.get("/caregiver-status", summary="Check absence timer states")(get_caregiver_status)

router.post("/process", summary="Process a frame for generic person tracking")(
    lambda user=Depends(get_current_user): run_tracking(user)
)
router.get("/zones", summary="List geofencing zones")(
    lambda user=Depends(get_current_user): manage_zones(user, action="list")
)
router.post("/zones", summary="Create geofencing zone")(
    lambda user=Depends(get_current_user): manage_zones(user, action="create")
)
router.get("/history", summary="Tracking history logs")(
    lambda user=Depends(get_current_user): get_tracking_history(user)
)
