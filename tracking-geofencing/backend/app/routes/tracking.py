"""
Tracking routes — mounted at /api/tracking by main.py
No prefix is added here; the prefix comes from app.include_router().
"""

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from app.controllers.tracking_controller import (
    handle_process_frame,
    handle_get_history,
    handle_get_active,
    handle_get_stats,
    handle_identify_person,
    handle_get_exit_alerts,
    handle_start_caregiver_session,
    handle_update_caregiver_visibility,
)
from app.models.tracking_models import ProcessFrameRequest

router = APIRouter()


@router.get("/exit-alerts")
async def get_exit_alerts():
    """Return last 20 zone exit alerts."""
    return await handle_get_exit_alerts()


@router.post("/process-frame")
async def process_frame(
    request: ProcessFrameRequest,
):
    """Process a video frame and return person detections."""
    return await handle_process_frame(request)


class IdentifyPersonRequest(BaseModel):
    frame_data: str
    person_id: str | None = None


@router.post("/identify-person")
async def identify_person(request: IdentifyPersonRequest):
    """Send a frame to face-verification and return identity if matched."""
    return await handle_identify_person(request.frame_data, request.person_id)


@router.post("/start-caregiver-session")
async def start_caregiver_session(payload: dict):
    """Register or handoff an active caregiver session for presence monitoring."""
    return await handle_start_caregiver_session(payload)


@router.post("/update-caregiver-visibility")
async def update_caregiver_visibility(payload: dict):
    """Process a webcam frame to evaluate presence & skeleton visibility."""
    return await handle_update_caregiver_visibility(payload)


@router.get("/history")
async def get_history(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """Retrieve tracking log history with pagination."""
    return await handle_get_history(page, page_size)


@router.get("/active")
async def get_active(
):
    """Get currently active (detected) persons."""
    return await handle_get_active()


@router.get("/stats")
async def get_stats(
):
    """Get tracking statistics for today."""
    return await handle_get_stats()


@router.get("/diagnostics")
async def diagnostics():
    """Return YOLO engine diagnostics for debugging."""
    from app.ml_services.yolo_tracker import tracker_engine
    return tracker_engine.get_diagnostics()

