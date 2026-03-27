"""
tracking-geofencing/backend/app/routes/tracking_routes.py
"""
from fastapi import APIRouter, Depends
from app.controllers.tracking_controller import (
    run_tracking,
    manage_zones,
    get_tracking_history,
)
from app.middleware.verify_token import get_current_user

router = APIRouter()

router.post("/process", summary="Process a frame for person tracking")(
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
