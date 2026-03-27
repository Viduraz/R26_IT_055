"""
face-verification/backend/app/controllers/face_controller.py
HTTP layer connecting routes to the Face ML service.
"""
from fastapi import APIRouter

from app.schemas.face_schema import EnrollFaceRequest, EnrollFaceResponse, VerifyFaceRequest, VerifyFaceResponse, VerifyCaregiverRequest, VerifyCaregiverResponse
from app.services.face_service import FaceService
from app.models.face_log_model import face_log_collection

_face_service = FaceService()

def enroll_caregiver_face(payload: EnrollFaceRequest) -> EnrollFaceResponse:
    result = _face_service.enroll_face(payload)
    return EnrollFaceResponse(**result)

def verify_caregiver_face(payload: VerifyFaceRequest) -> VerifyFaceResponse:
    result = _face_service.verify_face(payload)
    return VerifyFaceResponse(**result)

def verify_caregiver_search(payload: VerifyCaregiverRequest) -> VerifyCaregiverResponse:
    result = _face_service.verify_caregiver_search(payload)
    return VerifyCaregiverResponse(**result)

def get_verification_logs() -> list:
    logs = list(face_log_collection().find().sort("timestamp", -1).limit(50))
    for log in logs:
        log["_id"] = str(log["_id"])
    return logs
