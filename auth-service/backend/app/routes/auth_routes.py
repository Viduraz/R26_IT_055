"""
auth-service/backend/app/routes/auth_routes.py
HTTP route definitions for the Auth Service.
"""
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from app.controllers.auth_controller import (
    register_user,
    login_user,
    login_with_face,
    get_profile,
)
from app.services.camera_service import get_camera_frame, stream_camera_frames

router = APIRouter()

router.post("/register", summary="Register a new user")(register_user)
router.post("/login", summary="Login and receive JWT")(login_user)
router.post("/caregiver/verify-face-login", summary="Login with Face Verification for Caregiver")(login_with_face)
router.get("/me", summary="Get current user profile")(get_profile)



@router.get("/camera-snapshot", summary="Proxy latest IP camera frame as base64 JPEG for face capture UI")
def camera_snapshot():
    """
    Returns { "frame": "data:image/jpeg;base64,..." }
    The frontend polls this during face enrollment / login when IP camera source is selected.
    Uses a persistent RTSP background thread — response time ~1–5 ms after cold-start.
    """
    return {"frame": get_camera_frame()}


@router.get("/camera-stream", summary="Live MJPEG IP camera stream")
async def camera_stream():
    """
    High-performance real-time MJPEG stream for the IP camera.
    """
    return StreamingResponse(
        stream_camera_frames(),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

