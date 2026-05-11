"""
face-verification/backend/app/routes/face_routes.py
API Routing for the Face Verification microservice
"""
from fastapi import APIRouter
from app.controllers.face_controller import (
    enroll_caregiver_face,
    verify_caregiver_face,
    verify_caregiver_search,
    get_verification_logs,
    get_camera_snapshot,
    verify_from_camera,
)

router = APIRouter()

router.post("/enroll", summary="Extract and average face embeddings for enrollment")(enroll_caregiver_face)
router.post("/verify", summary="Compare a live face embedding to a stored ML embedding")(verify_caregiver_face)
router.post("/verify-caregiver", summary="Identify caregiver from live webcam stream")(verify_caregiver_search)
router.get("/verification-logs", summary="List recent biometric scans")(get_verification_logs)

# ── IP Camera routes ──────────────────────────────────────────────────────────
router.get("/camera-snapshot", summary="Proxy one JPEG snapshot from the IP camera as base64")(get_camera_snapshot)
router.post("/camera-verify", summary="Capture from IP camera and run caregiver verification in one step")(verify_from_camera)
