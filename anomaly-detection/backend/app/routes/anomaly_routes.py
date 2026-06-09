"""
anomaly-detection/backend/app/routes/anomaly_routes.py
"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
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


@router.websocket("/ws/process")
async def websocket_process(websocket: WebSocket):
    await websocket.accept()
    person_id = None
    try:
        while True:
            data = await websocket.receive_json()
            frame = data.get("live_frame")
            source = data.get("source")
            pid = data.get("person_id") or "default"
            person_id = pid
            
            if source == "ip_camera":
                from app.services.camera_service import get_camera_snapshot as _fetch_snapshot
                try:
                    frame = _fetch_snapshot()
                except Exception as ce:
                    await websocket.send_json({
                        "anomaly_type": "no_person",
                        "confidence": 0.0,
                        "severity": "none",
                        "error": f"Camera offline: {str(ce)}"
                    })
                    continue
            
            if not frame:
                await websocket.send_json({
                    "anomaly_type": "no_person",
                    "confidence": 0.0,
                    "severity": "none",
                    "error": "No live frame provided"
                })
                continue

            payload = AnomalyProcessRequest(
                live_frame=frame,
                person_id=pid,
                caregiver_id=data.get("caregiver_id"),
                session_id=data.get("session_id"),
                timestamp=data.get("timestamp")
            )
            result = await process_frame(payload)
            await websocket.send_json(result)
    except WebSocketDisconnect:
        if person_id:
            from app.ml_services.inference.sequence_buffer import flush
            flush(person_id)
            print(f"[websocket] Client disconnected. Cleared buffer for {person_id}")
    except Exception as e:
        print(f"[websocket] Error: {repr(e)}")


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

