"""
tracking-geofencing/backend/app/controllers/tracking_controller.py
"""
from app.services.tracking_service import TrackingService
from app.schemas.tracking_schema import SessionHandoffRequest, TrackVisibilityRequest

_svc = TrackingService()


async def start_caregiver_session(payload: SessionHandoffRequest):
    return await _svc.start_caregiver_session(payload)


async def update_caregiver_visibility(payload: TrackVisibilityRequest):
    return await _svc.update_visibility(payload)


async def get_caregiver_status(session_id: str):
    return await _svc.get_caregiver_status(session_id)


async def run_tracking(user: dict):
    # TODO: loop over raw YOLOv8 fallback logic if needed
    return await _svc.process_frame(user_id=user.get("sub"))


async def manage_zones(user: dict, action: str = "list"):
    if action == "list":
        return await _svc.list_zones()
    if action == "create":
        return {"message": "TODO: accept zone payload and save to DB"}
    return {}


async def get_tracking_history(user: dict):
    return await _svc.get_history()
