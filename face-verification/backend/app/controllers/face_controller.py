"""
face-verification/backend/app/controllers/face_controller.py
HTTP layer connecting routes to the Face ML service.
"""
from fastapi import APIRouter

from app.schemas.face_schema import EnrollFaceRequest, EnrollFaceResponse, VerifyFaceRequest, VerifyFaceResponse
from app.services.face_service import FaceService

_face_service = FaceService()

def enroll_caregiver_face(payload: EnrollFaceRequest) -> EnrollFaceResponse:
    result = _face_service.enroll_face(payload)
    return EnrollFaceResponse(**result)

def verify_caregiver_face(payload: VerifyFaceRequest) -> VerifyFaceResponse:
    result = _face_service.verify_face(payload)
    return VerifyFaceResponse(**result)
