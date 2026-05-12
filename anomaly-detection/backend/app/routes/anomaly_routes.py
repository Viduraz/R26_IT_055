"""
anomaly-detection/backend/app/routes/anomaly_routes.py
"""
from fastapi import APIRouter
from app.controllers.anomaly_controller import (
    process_frame,
    get_history,
    get_model_status,
    get_camera_snapshot,
    process_frame_from_camera,
    probe_camera,
)
from app.schemas.anomaly_schema import AnomalyProcessRequest, CameraProcessRequest

router = APIRouter()


@router.post("/process", summary="Run full anomaly detection pipeline on a live frame")
async def _process(payload: AnomalyProcessRequest):
    return await process_frame(payload)


@router.get("/history", summary="Anomaly detection event history (last 100)")
async def _history():
    return await get_history()


@router.get("/model-status", summary="ML model weights + pipeline status")
async def _model_status():
    return await get_model_status()


@router.get("/health", summary="Service health check")
def _health():
    return {"status": "ok", "service": "anomaly-detection"}


# ── IP Camera routes ──────────────────────────────────────────────────────────

@router.get("/camera-snapshot", summary="Proxy one JPEG snapshot from the IP camera as base64")
def _camera_snapshot():
    return get_camera_snapshot()


@router.post("/camera-process", summary="Capture from IP camera and run anomaly detection in one step")
async def _camera_process(payload: CameraProcessRequest):
    return await process_frame_from_camera(payload)


@router.get("/camera-probe", summary="Diagnostic: probe all known snapshot URLs and report which work")
def _camera_probe():
    return probe_camera()

