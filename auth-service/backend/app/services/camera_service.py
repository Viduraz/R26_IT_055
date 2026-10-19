"""
auth-service/backend/app/services/camera_service.py

Persistent IP camera frame buffer with a background capture thread.
Identical in design to anomaly-detection/backend/app/services/camera_service.py
so the auth-service can serve IP-camera frames for face enrollment / login
without re-opening an RTSP connection on every request.

Environment variables (.env):
  IP_CAMERA_HOST        = 169.254.110.15
  IP_CAMERA_USER        = admin
  IP_CAMERA_PASS        = admin
  IP_CAMERA_RTSP_URL    = rtsp://admin:admin@169.254.110.15:554/stream1
"""
import os
import base64
import time
import threading

import cv2
import httpx

# ── HTTP snapshot fallback paths (HK2 / Hikvision-compatible) ─────────────────
_SNAPSHOT_PATHS = [
    "/onvif/snapshot",
    "/cgi-bin/snapshot.cgi",
    "/snapshot.cgi",
    "/ISAPI/Streaming/channels/101/picture",
    "/snapshot",
    "/tmpfs/snap.jpg",
    "/video/mjpg.cgi",
    "/cgi-bin/CGIProxy.fcgi?cmd=snapPicture&usr={user}&pwd={pwd}",
]

_discovered_url: str | None = None


def _try_http_snapshot(host: str, user: str, pwd: str) -> bytes | None:
    global _discovered_url
    base = f"http://{host}"
    urls = [base + p.format(user=user, pwd=pwd) for p in _SNAPSHOT_PATHS]
    if _discovered_url:
        urls = [_discovered_url] + [u for u in urls if u != _discovered_url]
    for url in urls:
        try:
            resp = httpx.get(url, auth=(user, pwd), timeout=4.0, follow_redirects=True)
            if resp.status_code == 200:
                ct = resp.headers.get("content-type", "")
                if "image" in ct or len(resp.content) > 1000:
                    _discovered_url = url
                    return resp.content
        except Exception:
            continue
    return None


# ── Persistent RTSP stream ────────────────────────────────────────────────────

class _CameraStream:
    """Background daemon that keeps RTSP open and buffers the latest JPEG."""

    def __init__(self) -> None:
        self._lock          = threading.Lock()
        self._latest_jpeg:  bytes | None = None
        self._error:        str   | None = None
        self._thread:       threading.Thread | None = None
        self._running                    = False
        self._host:     str = ""
        self._user:     str = ""
        self._pwd:      str = ""
        self._rtsp_url: str = ""

    def start(self) -> None:
        if self._running:
            return
        self._host     = os.getenv("IP_CAMERA_HOST",     "169.254.110.15")
        self._user     = os.getenv("IP_CAMERA_USER",     "admin")
        self._pwd      = os.getenv("IP_CAMERA_PASS",     "admin")
        self._rtsp_url = os.getenv(
            "IP_CAMERA_RTSP_URL",
            f"rtsp://{self._user}:{self._pwd}@{self._host}:554/stream1",
        )
        self._running = True
        self._thread  = threading.Thread(
            target=self._capture_loop, daemon=True, name="auth-rtsp-capture"
        )
        self._thread.start()
        print("[auth-camera] Persistent RTSP capture thread started.")

    def stop(self) -> None:
        self._running = False

    def get_latest_jpeg(self) -> bytes | None:
        with self._lock:
            return self._latest_jpeg

    def get_error(self) -> str | None:
        with self._lock:
            return self._error

    def _capture_loop(self) -> None:
        backoff = 1.0
        while self._running:
            cap = None
            try:
                # Optimizing latency for real-time MJPEG stream streaming (drop buffers)
                os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|fflags;nobuffer|flags;low_delay"
                print(f"[auth-camera] Connecting RTSP: {self._rtsp_url}")
                cap = cv2.VideoCapture(self._rtsp_url, cv2.CAP_FFMPEG)
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                if not cap.isOpened():
                    raise RuntimeError("cv2.VideoCapture could not open RTSP URL")
                print("[auth-camera] RTSP connected ✓")
                with self._lock:
                    self._error = None
                backoff = 1.0
                while self._running:
                    ok, frame = cap.read()
                    if not ok or frame is None:
                        print("[auth-camera] Empty frame — reconnecting…")
                        break
                    # Faster JPEG encoding and lower payload size (70% instead of 90%)
                    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
                    with self._lock:
                        self._latest_jpeg = buf.tobytes()
                        self._error       = None
            except Exception as exc:
                err = f"RTSP error: {type(exc).__name__}: {exc}"
                print(f"[auth-camera] {err}")
                with self._lock:
                    self._error = err
            finally:
                if cap is not None:
                    cap.release()
            if self._running:
                print(f"[auth-camera] Reconnecting in {backoff:.1f}s…")
                time.sleep(backoff)
                backoff = min(backoff * 2, 30.0)


_stream = _CameraStream()


# ── Public API ────────────────────────────────────────────────────────────────

import asyncio

async def stream_camera_frames():
    """
    Generator yielding MJPEG frames from the background thread.
    """
    _stream.start()
    while True:
        jpeg = _stream.get_latest_jpeg()
        if jpeg is not None:
            yield (b"--frame\r\n"
                   b"Content-Type: image/jpeg\r\n\r\n" + jpeg + b"\r\n")
        else:
            fallback = _try_http_snapshot(_stream._host, _stream._user, _stream._pwd)
            if fallback:
                yield (b"--frame\r\n"
                       b"Content-Type: image/jpeg\r\n\r\n" + fallback + b"\r\n")
        
        await asyncio.sleep(0.033) # ~30 fps


def get_camera_frame() -> str:
    """
    Return the latest frame as a base64 JPEG data URL.
    Starts the background thread on first call.
    Falls back to HTTP snapshot on cold-start / RTSP down.
    Raises HTTPException 503 if no frame is available.
    """
    from fastapi import HTTPException, status

    _stream.start()
    jpeg = _stream.get_latest_jpeg()

    if jpeg is None:
        print("[auth-camera] No buffered frame → HTTP fallback")
        jpeg = _try_http_snapshot(_stream._host, _stream._user, _stream._pwd)

    if jpeg is None:
        err = _stream.get_error() or "RTSP thread not yet connected"
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                f"Cannot reach IP camera at {_stream._host}. {err}. "
                "Check network connectivity and .env credentials."
            ),
        )

    b64 = base64.b64encode(jpeg).decode("utf-8")
    return f"data:image/jpeg;base64,{b64}"
