"""
face-verification/backend/app/controllers/face_controller.py
"""
from app.services.face_service import FaceService

_svc = FaceService()


async def verify_face(user: dict):
    # TODO: Accept image frame from request body and pass to service
    return await _svc.run_verification(user_id=user.get("sub"))


async def get_logs(user: dict):
    return await _svc.fetch_logs()


async def get_authorized_persons(user: dict):
    return await _svc.fetch_authorized_persons()
