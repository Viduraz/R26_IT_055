"""
schedule-monitoring/backend/app/routes/monitoring_routes.py
Monitoring endpoints: detection events, today's status, logs, notifications,
and an MJPEG proxy stream for the IP camera.
"""
import os
import cv2
import time
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from typing import Optional
from pydantic import BaseModel
from datetime import datetime
from app.controllers.monitoring_controller import (
    handle_detection_event,
    get_today_status,
    get_activity_logs,
    get_notifications,
    mark_notification_read,
    mark_all_notifications_read,
    trigger_missed_evaluation,
)

router = APIRouter()

# ── IP Camera MJPEG Stream ──────────────────────────────────────────────────

def _build_rtsp_url() -> str:
    """Build RTSP URL from env. Uses IP_CAMERA_RTSP_URL if set, otherwise
    constructs one from host/user/pass."""
    rtsp = os.getenv("IP_CAMERA_RTSP_URL", "").strip()
    if rtsp:
        return rtsp
    host = os.getenv("IP_CAMERA_HOST", "169.254.110.15")
    user = os.getenv("IP_CAMERA_USER", "admin")
    pwd  = os.getenv("IP_CAMERA_PASS", "admin")
    return f"rtsp://{user}:{pwd}@{host}:554/stream1"


def _mjpeg_generator():
    """Generator that yields MJPEG frames from the IP camera RTSP stream."""
    rtsp_url = _build_rtsp_url()
    cap = None
    retry_delay = 2  # seconds between reconnect attempts

    while True:
        try:
            if cap is None or not cap.isOpened():
                cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

            ret, frame = cap.read()
            if not ret:
                # Camera temporarily unavailable — send a placeholder frame
                if cap:
                    cap.release()
                    cap = None
                time.sleep(retry_delay)
                continue

            # Encode as JPEG (quality 80 for good balance of size vs clarity)
            encode_params = [cv2.IMWRITE_JPEG_QUALITY, 80]
            _, jpeg = cv2.imencode(".jpg", frame, encode_params)
            data = jpeg.tobytes()

            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n" + data + b"\r\n"
            )

        except GeneratorExit:
            break
        except Exception as exc:
            print(f"[ip_cam] stream error: {exc}")
            if cap:
                cap.release()
                cap = None
            time.sleep(retry_delay)

    if cap:
        cap.release()


@router.get(
    "/camera/stream",
    summary="MJPEG proxy stream from the IP camera",
    response_class=StreamingResponse,
)
async def ip_camera_stream():
    """
    Returns a multipart/x-mixed-replace MJPEG stream directly from the
    IP camera RTSP feed, so the browser can consume it as a plain <video>
    or <img> src without needing RTSP support.
    """
    return StreamingResponse(
        _mjpeg_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
        },
    )


# ── Detection / Monitoring Routes ───────────────────────────────────────────

class DetectionEventPayload(BaseModel):
    patient_id: str = "patient_001"
    detected_activity: str          # "eating" | "sleeping" | "walking" | "medication" | …
    timestamp: Optional[datetime] = None
    confidence: float = 0.0
    caregiver_present: bool = False
    caregiver_id: Optional[str] = None


@router.post("/detection-event", summary="Receive a vision detection event")
async def _detection(payload: DetectionEventPayload):
    return await handle_detection_event(payload.model_dump())


@router.get("/today/{patient_id}", summary="Get today's monitoring status for a patient")
async def _today(patient_id: str):
    return await get_today_status(patient_id)


@router.get("/logs/{patient_id}", summary="Get full activity log history")
async def _logs(patient_id: str):
    return await get_activity_logs(patient_id)


@router.get("/notifications/{patient_id}", summary="Get notifications for family")
async def _notifications(patient_id: str):
    return await get_notifications(patient_id)


@router.put("/notifications/{notification_id}/read", summary="Mark a notification as read")
async def _mark_read(notification_id: str):
    return await mark_notification_read(notification_id)


@router.put("/notifications/{patient_id}/read-all", summary="Mark all notifications read")
async def _mark_all_read(patient_id: str):
    return await mark_all_notifications_read(patient_id)


@router.post("/evaluate-missed/{patient_id}", summary="Manually trigger missed-task evaluation")
async def _evaluate_missed(patient_id: str):
    return await trigger_missed_evaluation(patient_id)
