"""
tracking-geofencing/backend/app/controllers/tracking_controller.py
"""
from app.services.tracking_service import TrackingService

_svc = TrackingService()


async def run_tracking(user: dict):
    # TODO: accept frame bytes in body
    return await _svc.process_frame(user_id=user.get("sub"))


async def manage_zones(user: dict, action: str = "list"):
    if action == "list":
        return await _svc.list_zones()
    if action == "create":
        return {"message": "TODO: accept zone payload and save to DB"}
    return {}


async def get_tracking_history(user: dict):
    return await _svc.get_history()
