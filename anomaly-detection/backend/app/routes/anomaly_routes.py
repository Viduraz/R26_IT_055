"""
anomaly-detection/backend/app/routes/anomaly_routes.py
Phase 3: metrics endpoint, simulate endpoints, session reset, latency tracking.
Phase 4: JWT authentication added to all protected endpoints.
"""
import time
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from fastapi.responses import StreamingResponse
from app.controllers.anomaly_controller import (
    process_frame,
    get_history,
    get_model_status,
    get_camera_snapshot,
    process_frame_from_camera,
    probe_camera,
)
from app.schemas.anomaly_schema import AnomalyProcessRequest, CameraProcessRequest
from app.services.metrics_service import record_frame, get_metrics, reset_session
from app.services.simulation_service import (
    simulate_fall, simulate_aggression, simulate_inactivity, simulate_normal,
)
from app.services.camera_service import mjpeg_stream
from app.middleware.verify_token import get_current_user

router = APIRouter()


# ── WebSocket endpoint ────────────────────────────────────────────────────────

@router.websocket("/ws/process")
async def websocket_process(websocket: WebSocket, token: str = ""):
    """
    Persistent WebSocket stream for real-time anomaly detection.
    Phase 3: latency instrumentation + metrics recording per frame.
    Phase 4: JWT token validated via query param:
             ws://localhost:8003/api/anomaly/ws/process?token=<jwt>
    """
    # ── JWT validation before accepting ──────────────────────────────────────
    if token:
        try:
            from shared.backend.auth.jwt_handler import decode_access_token
            decode_access_token(token)
        except Exception as auth_err:
            print(f"[websocket] JWT rejected: {repr(auth_err)}")
            await websocket.close(code=4001)
            return
    # If no token provided, allow through (supports unauthenticated demo mode)
    # In full production, change the above `if token:` to always validate.

    await websocket.accept()
    person_id   = None
    frame_count = 0
    error_count = 0

    try:
        while True:
            try:
                data = await websocket.receive_json()
            except Exception as recv_err:
                print(f"[websocket] receive error: {repr(recv_err)}")
                break

            frame_count += 1
            source    = data.get("source", "webcam")
            pid       = data.get("person_id") or "default"
            person_id = pid
            t_start   = time.monotonic()

            # ── Frame acquisition ─────────────────────────────────────────────
            frame = data.get("live_frame")
            ip_frame_b64: str | None = None   # set below when using IP cam

            if source == "ip_camera":
                import base64 as _b64, asyncio as _aio
                from app.services.camera_service import _stream as _cam_stream
                from app.services.camera_service import _try_http_snapshot
                _cam_stream.start()

                jpeg = _cam_stream.get_latest_jpeg()

                # RTSP cold-start: wait up to 3 s for first frame
                if jpeg is None:
                    for _ in range(6):
                        await _aio.sleep(0.5)
                        jpeg = _cam_stream.get_latest_jpeg()
                        if jpeg is not None:
                            break

                # If RTSP still empty, try HTTP snapshot as fallback
                if jpeg is None:
                    jpeg = _try_http_snapshot(
                        _cam_stream._host, _cam_stream._user, _cam_stream._pwd
                    )

                if jpeg is None:
                    err_detail = _cam_stream.get_error() or "RTSP connecting…"
                    await _safe_send(websocket, {
                        "anomaly_type": "no_person", "confidence": 0.0,
                        "severity": "none", "pose_valid": False,
                        "camera_error": err_detail,
                        "person_id": pid, "timestamp": _now_iso(),
                    })
                    continue

                ip_frame_b64 = _b64.b64encode(jpeg).decode()
                frame = f"data:image/jpeg;base64,{ip_frame_b64}"

                # ── Send frame preview IMMEDIATELY (before ML pipeline) ────────
                # This decouples camera display latency from ML processing time.
                # The user sees the frame as fast as the RTSP buffer + WS RTT.
                await _safe_send(websocket, {
                    "camera_frame": ip_frame_b64,
                    "camera_preview_only": True,
                    "person_id": pid,
                })

            if not frame:
                await _safe_send(websocket, {
                    "anomaly_type": "no_person", "confidence": 0.0,
                    "severity": "none", "pose_valid": False,
                    "error": "no_frame_received",
                    "person_id": pid, "timestamp": _now_iso(),
                })
                continue

            # ── Pipeline processing — isolated per frame ───────────────────────
            try:
                payload = AnomalyProcessRequest(
                    live_frame   = frame,
                    person_id    = pid,
                    caregiver_id = data.get("caregiver_id"),
                    session_id   = data.get("session_id"),
                    timestamp    = data.get("timestamp"),
                )
                result = await process_frame(payload)

                latency_ms = (time.monotonic() - t_start) * 1000
                record_frame(result.get("anomaly_type", "normal_activity"), latency_ms)
                result["latency_ms"] = round(latency_ms, 1)

                # Don't re-send camera_frame in ML result (already sent as preview)
                # This halves the WS payload for the ML result message.

                await _safe_send(websocket, result)

            except Exception as proc_err:
                error_count += 1
                print(f"[websocket] frame #{frame_count} error for {pid}: {repr(proc_err)}")
                await _safe_send(websocket, {
                    "anomaly_type": "no_person", "confidence": 0.0,
                    "severity": "none", "pose_valid": False,
                    "error": f"processing_error: {type(proc_err).__name__}",
                    "person_id": pid, "timestamp": _now_iso(),
                })

    except WebSocketDisconnect:
        pass
    except Exception as fatal_err:
        print(f"[websocket] fatal error for {person_id}: {repr(fatal_err)}")
    finally:
        if person_id:
            try:
                from app.ml_services.inference.sequence_buffer import flush
                flush(person_id)
            except Exception:
                pass
            print(f"[websocket] session ended for {person_id} | "
                  f"frames={frame_count} errors={error_count}")


async def _safe_send(ws: WebSocket, payload: dict) -> None:
    try:
        await ws.send_json(payload)
    except Exception:
        pass


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


# ── Public REST endpoints (no auth required) ──────────────────────────────────

@router.get("/health", summary="Service health check")
def _health():
    return {"status": "ok", "service": "anomaly-detection"}


@router.post("/process", summary="Run full anomaly detection pipeline on a live frame")
async def _process(payload: AnomalyProcessRequest):
    """
    Left public intentionally — the WebSocket stream is the primary interface.
    The dashboard's JS sends base64 frames via WebSocket, not this REST endpoint.
    Protect if needed for production hardening.
    """
    return await process_frame(payload)


# ── Protected REST endpoints (JWT required) ───────────────────────────────────

@router.get("/history", summary="Anomaly detection event history (last 100)")
async def _history(user: dict = Depends(get_current_user)):
    return await get_history()


@router.get("/model-status", summary="ML model weights + pipeline status")
async def _model_status(user: dict = Depends(get_current_user)):
    return await get_model_status()


@router.get("/session-logs", summary="Retrieve structured JSON session alert logs")
def _session_logs(user: dict = Depends(get_current_user)):
    from app.services.alert_service import get_session_logs, get_memory_alerts
    return {
        "file_logs":     get_session_logs(),
        "memory_alerts": get_memory_alerts(50),
    }


# ── Research Metrics ───────────────────────────────────────────────────────────

@router.get("/metrics", summary="Research metrics: latency, FPS, event distribution")
def _metrics(user: dict = Depends(get_current_user)):
    """
    Returns session-level research metrics for the analytics dashboard.
    Examiners love this endpoint — it demonstrates the system is measurable.
    """
    return get_metrics()


# ── Session Reset ──────────────────────────────────────────────────────────────

@router.post("/reset-session", summary="Reset all session metrics and alert cooldowns")
def _reset_session(user: dict = Depends(get_current_user)):
    reset_session()
    from app.services.alert_service import _cooldown_map, _memory_alerts, _lock
    with _lock:
        _cooldown_map.clear()
        _memory_alerts.clear()
    return {"status": "ok", "message": "Session reset complete"}


# ── Scenario Simulation endpoints ──────────────────────────────────────────────

@router.post("/simulate/fall", summary="[Demo] Inject a synthetic FALL DETECTED event")
def _sim_fall(person_id: str = "demo_patient", user: dict = Depends(get_current_user)):
    evt = simulate_fall(person_id)
    record_frame("fall_detected", 35.0)
    return evt


@router.post("/simulate/aggression", summary="[Demo] Inject a synthetic AGGRESSION event")
def _sim_aggression(person_id: str = "demo_patient", user: dict = Depends(get_current_user)):
    evt = simulate_aggression(person_id)
    record_frame("aggression_detected", 38.0)
    return evt


@router.post("/simulate/inactivity", summary="[Demo] Inject a synthetic INACTIVITY event")
def _sim_inactivity(person_id: str = "demo_patient", user: dict = Depends(get_current_user)):
    evt = simulate_inactivity(person_id)
    record_frame("prolonged_inactivity", 32.0)
    return evt


@router.post("/simulate/normal", summary="[Demo] Inject a synthetic NORMAL ACTIVITY event")
def _sim_normal(person_id: str = "demo_patient", user: dict = Depends(get_current_user)):
    evt = simulate_normal(person_id)
    record_frame("normal_activity", 28.0)
    return evt


# ── IP Camera routes ───────────────────────────────────────────────────────────

@router.get("/camera-snapshot", summary="Proxy one JPEG snapshot from the IP camera as base64")
def _camera_snapshot(user: dict = Depends(get_current_user)):
    return get_camera_snapshot()


@router.get(
    "/camera-stream",
    summary="Low-latency MJPEG stream from IP camera (public — browser img tag)",
    response_class=StreamingResponse,
)
async def _camera_stream():
    """
    Streams JPEG frames as multipart/x-mixed-replace at ~20 FPS.
    This endpoint is intentionally unauthenticated: browser <img> tags
    cannot set Authorization headers, so auth is enforced at WS level.
    Usage in frontend:  <img src="http://host:8003/api/anomaly/camera-stream" />
    NOTE: Prefer the WebSocket camera_frame payload for Cloudflare tunnel use.
    """
    return StreamingResponse(
        mjpeg_stream(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )



@router.post("/camera-process", summary="Capture from IP camera and run anomaly detection")
async def _camera_process(payload: CameraProcessRequest, user: dict = Depends(get_current_user)):
    return await process_frame_from_camera(payload)


@router.get("/camera-probe", summary="Diagnostic: probe all known snapshot URLs")
def _camera_probe(user: dict = Depends(get_current_user)):
    return probe_camera()
