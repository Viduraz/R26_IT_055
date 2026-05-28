"""
anomaly-detection/backend/app/services/camera_service.py

Persistent IP camera frame buffer with a background capture thread.

Strategy:
  1. On first request a background daemon thread is started that keeps
     cv2.VideoCapture open on the RTSP URL.
  2. The thread reads frames in a tight loop and stores the latest JPEG
     in an in-memory buffer (thread-safe via a Lock).
  3. GET /camera-snapshot returns the buffered frame instantly (~1–5 ms)
     instead of opening a new RTSP connection on every poll.
  4. If the stream drops the thread auto-reconnects with exponential backoff.
  5. On first connect (or RTSP failure) falls back to an HTTP snapshot so
     the frontend isn't blocked on a cold start.

Environment (.env):
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

# ── Known HK2 / Hikvision-compatible HTTP snapshot paths ─────────────────────
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

# Cache the working HTTP URL so we hit it directly on subsequent calls
_discovered_url: str | None = None


def _build_snapshot_urls(host: str, user: str, pwd: str) -> list[str]:
    base = f"http://{host}"
    return [base + path.format(user=user, pwd=pwd) for path in _SNAPSHOT_PATHS]


def _try_http_snapshot(host: str, user: str, pwd: str) -> bytes | None:
    """
    Try every known HTTP snapshot path.
    Returns raw JPEG bytes on first success, or None if all fail.
    """
    global _discovered_url
    urls = _build_snapshot_urls(host, user, pwd)

    # Put the previously-discovered URL first so we skip the discovery scan
    if _discovered_url:
        urls = [_discovered_url] + [u for u in urls if u != _discovered_url]

    for url in urls:
        try:
            resp = httpx.get(url, auth=(user, pwd), timeout=4.0, follow_redirects=True)
            if resp.status_code == 200:
                ct = resp.headers.get("content-type", "")
                if "image" in ct or len(resp.content) > 1000:
                    _discovered_url = url
                    print(f"[camera] ✓ HTTP snapshot URL: {url}")
                    return resp.content
        except Exception as exc:
            print(f"[camera] HTTP {url} → {type(exc).__name__}")
            continue

    return None


# ── Persistent RTSP Stream ────────────────────────────────────────────────────

class _CameraStream:
    """
    Singleton background thread that keeps an RTSP VideoCapture open and
    continuously writes the latest decoded JPEG into an in-memory buffer.

    Callers just do: jpeg_bytes = _stream.get_latest_jpeg()
    That call holds the lock for microseconds — no network I/O involved.
    """

    def __init__(self) -> None:
        self._lock          = threading.Lock()
        self._latest_jpeg:  bytes | None = None
        self._error:        str   | None = None
        self._thread:       threading.Thread | None = None
        self._running                    = False

        # Populated from env the first time start() is called
        self._host:     str = ""
        self._user:     str = ""
        self._pwd:      str = ""
        self._rtsp_url: str = ""

    # ── Public API ────────────────────────────────────────────────────────────

    def start(self) -> None:
        """Start the background capture thread (idempotent — safe to call many times)."""
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
            target=self._capture_loop, daemon=True, name="rtsp-capture"
        )
        self._thread.start()
        print("[camera] Persistent RTSP capture thread started.")

    def stop(self) -> None:
        """Signal the capture thread to stop (graceful shutdown)."""
        self._running = False

    def get_latest_jpeg(self) -> bytes | None:
        """Return the most-recently captured JPEG bytes (thread-safe, non-blocking)."""
        with self._lock:
            return self._latest_jpeg

    def get_error(self) -> str | None:
        """Return the last error string, or None if the stream is healthy."""
        with self._lock:
            return self._error

    # ── Background thread ─────────────────────────────────────────────────────

    def _capture_loop(self) -> None:
        """
        Main capture loop.

        Opens RTSP, reads frames as fast as the camera delivers them, and
        stores the latest JPEG in the buffer.  On any failure it waits with
        exponential back-off and then reconnects.
        """
        backoff = 1.0

        while self._running:
            cap = None
            try:
                print(f"[camera] Connecting to RTSP: {self._rtsp_url}")
                cap = cv2.VideoCapture(self._rtsp_url, cv2.CAP_FFMPEG)

                # Keep only 1 frame in OpenCV's internal queue so we always
                # serve the *freshest* frame, not a stale buffered one.
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

                if not cap.isOpened():
                    raise RuntimeError("cv2.VideoCapture could not open the RTSP URL")

                print("[camera] RTSP connected ✓")
                with self._lock:
                    self._error = None          # clear any previous error
                backoff = 1.0                   # reset back-off on success

                while self._running:
                    ok, frame = cap.read()
                    if not ok or frame is None:
                        print("[camera] Empty frame — stream may have dropped, reconnecting…")
                        break

                    # Encode to JPEG at 85% quality (good balance of size vs. fidelity)
                    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
                    jpeg = buf.tobytes()

                    with self._lock:
                        self._latest_jpeg = jpeg
                        self._error       = None

            except Exception as exc:
                err_msg = f"RTSP error: {type(exc).__name__}: {exc}"
                print(f"[camera] {err_msg}")
                with self._lock:
                    self._error = err_msg

            finally:
                if cap is not None:
                    cap.release()

            if self._running:
                print(f"[camera] Will reconnect in {backoff:.1f}s…")
                time.sleep(backoff)
                backoff = min(backoff * 2, 30.0)   # exponential back-off, max 30 s


# ── Module-level singleton ────────────────────────────────────────────────────

_stream = _CameraStream()


# ── Public entry points ───────────────────────────────────────────────────────

def get_camera_snapshot() -> str:
    """
    Return the latest camera frame as a base64 JPEG data URL.

    On first call: starts the background RTSP thread and attempts an HTTP
    snapshot as an immediate fallback while RTSP is still connecting.

    On subsequent calls: returns from the in-memory buffer in ~1–5 ms.

    Raises:
        HTTPException 503  — if no frame is available via any method.
    """
    from fastapi import HTTPException, status

    # Ensure the background thread is running
    _stream.start()

    jpeg_bytes = _stream.get_latest_jpeg()

    # Cold-start / RTSP-down fallback: try an HTTP snapshot once
    if jpeg_bytes is None:
        print("[camera] No buffered frame yet → HTTP snapshot fallback")
        jpeg_bytes = _try_http_snapshot(_stream._host, _stream._user, _stream._pwd)

    if jpeg_bytes is None:
        err = _stream.get_error() or "RTSP thread not yet connected"
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                f"Cannot reach IP camera at {_stream._host}. {err}. "
                "Check: 1) Camera is on the same network. "
                "2) IP_CAMERA_USER / IP_CAMERA_PASS in .env are correct. "
                "3) IP_CAMERA_RTSP_URL is set correctly."
            ),
        )

    b64 = base64.b64encode(jpeg_bytes).decode("utf-8")
    return f"data:image/jpeg;base64,{b64}"


def probe_all_paths() -> dict:
    """
    Diagnostic: test every known HTTP snapshot URL and report RTSP status.
    Call GET /api/anomaly/camera-probe to see results.
    """
    _stream.start()   # ensure thread is running so we can report its state

    host     = _stream._host     or os.getenv("IP_CAMERA_HOST",     "169.254.110.15")
    user     = _stream._user     or os.getenv("IP_CAMERA_USER",     "admin")
    pwd      = _stream._pwd      or os.getenv("IP_CAMERA_PASS",     "admin")
    rtsp_url = _stream._rtsp_url or os.getenv(
        "IP_CAMERA_RTSP_URL", f"rtsp://{user}:{pwd}@{host}:554/stream1"
    )

    results = []
    working = []

    for path in _SNAPSHOT_PATHS:
        url   = f"http://{host}" + path.format(user=user, pwd=pwd)
        entry = {"url": url, "status": None, "content_type": None, "size_bytes": None, "ok": False}
        try:
            resp = httpx.get(url, auth=(user, pwd), timeout=4.0, follow_redirects=True)
            ct   = resp.headers.get("content-type", "")
            entry["status"]       = resp.status_code
            entry["content_type"] = ct
            entry["size_bytes"]   = len(resp.content)
            if resp.status_code == 200 and ("image" in ct or len(resp.content) > 1000):
                entry["ok"] = True
                working.append(url)
        except Exception as exc:
            entry["status"] = f"ERROR: {type(exc).__name__}: {exc}"
        results.append(entry)

    # Report live RTSP thread status (no new connection needed)
    buffered   = _stream.get_latest_jpeg()
    rtsp_ok    = buffered is not None
    rtsp_msg   = (
        f"Live — latest frame is {len(buffered)} bytes" if rtsp_ok
        else (_stream.get_error() or "Connecting…")
    )

    return {
        "camera_host":              host,
        "camera_user":              user,
        "rtsp_url":                 rtsp_url,
        "rtsp_ok":                  rtsp_ok,
        "rtsp_status":              rtsp_msg,
        "stream_thread_running":    _stream._running,
        "working_http_urls":        working,
        "recommended_snapshot_url": working[0] if working else None,
        "all_paths_tested":         results,
        "tip": (
            "If working_http_urls is empty and rtsp_ok is false, "
            "check the camera is on the same network segment and credentials are correct. "
            "Set IP_CAMERA_RTSP_URL in .env to the correct RTSP path from your camera's Stream Manager."
        ),
    }
