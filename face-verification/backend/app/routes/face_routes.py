"""
face-verification/backend/app/routes/face_routes.py
API Routing for the Face Verification microservice
"""
from fastapi import APIRouter
from app.controllers.face_controller import (
    enroll_caregiver_face,
    verify_caregiver_face
)

router = APIRouter()

router.post("/enroll", summary="Extract and average face embeddings for enrollment")(enroll_caregiver_face)
router.post("/verify", summary="Compare a live face embedding to a stored ML embedding")(verify_caregiver_face)
