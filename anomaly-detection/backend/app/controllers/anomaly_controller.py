"""
anomaly-detection/backend/app/controllers/anomaly_controller.py
"""
from app.services.anomaly_service import AnomalyService
from app.services.camera_service  import (
    get_camera_snapshot as _fetch_snapshot,
    probe_all_paths,
)
from app.schemas.anomaly_schema   import AnomalyProcessRequest, CameraProcessRequest

_svc = AnomalyService()


async def process_frame(payload: AnomalyProcessRequest):
    return await _svc.process_frame(payload)


async def get_history():
    return await _svc.fetch_logs()


async def get_model_status():
    return await _svc.get_status()


# ── IP Camera controllers ──────────────────────────────────────────────────────────

def get_camera_snapshot() -> dict:
    """
    GET /api/anomaly/camera-snapshot
    Returns a single JPEG frame from the IP camera as a base64 data URL.
    The frontend uses this to preview the camera stream in the AnomalyDashboard.
    """
    frame_b64 = _fetch_snapshot()
    return {"frame": frame_b64}


async def process_frame_from_camera(payload: CameraProcessRequest):
    """
    POST /api/anomaly/camera-process
    Fetch a frame from the IP camera and run the full anomaly pipeline.
    The client only supplies context (person_id, session_id, etc.).
    """
    frame_b64 = _fetch_snapshot()
    full_payload = AnomalyProcessRequest(
        live_frame   = frame_b64,
        person_id    = payload.person_id,
        caregiver_id = payload.caregiver_id,
        session_id   = payload.session_id,
        timestamp    = payload.timestamp,
    )
    return await _svc.process_frame(full_payload)


def probe_camera() -> dict:
    """
    GET /api/anomaly/camera-probe
    Tests all known snapshot URL paths and RTSP and reports which ones respond.
    Open http://localhost:8003/api/anomaly/camera-probe in your browser to diagnose.
    """
    return probe_all_paths()
