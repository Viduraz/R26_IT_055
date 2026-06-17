"""
face-verification/backend/app/services/camera_service.py

Robust IP camera frame fetcher with auto-discovery:

Strategy (in order):
  1. Try HTTP snapshot on all known HK2/Hikvision URL patterns
  2. Fall back to RTSP via OpenCV (cv2.VideoCapture) — most reliable

The camera host/credentials come from .env:
  IP_CAMERA_HOST        = 169.254.110.15
  IP_CAMERA_USER        = admin
  IP_CAMERA_PASS        = admin
  IP_CAMERA_RTSP_URL    = rtsp://admin:admin@169.254.110.15:554/stream1
"""
import os
import base64
import cv2
import httpx
from fastapi import HTTPException, status

# ── Known HK2 / Hikvision-compatible snapshot paths ───────────────────────────
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


def _build_snapshot_urls(host: str, user: str, pwd: str) -> list[str]:
    base = f"http://{host}"
    return [
        base + path.format(user=user, pwd=pwd)
        for path in _SNAPSHOT_PATHS
    ]


def _try_http_snapshot(host: str, user: str, pwd: str) -> bytes | None:
    global _discovered_url
    urls = _build_snapshot_urls(host, user, pwd)
    if _discovered_url:
        urls = [_discovered_url] + [u for u in urls if u != _discovered_url]

    for url in urls:
        try:
            resp = httpx.get(
                url,
                auth=(user, pwd),
                timeout=4.0,
                follow_redirects=True,
            )
            if resp.status_code == 200:
                ct = resp.headers.get("content-type", "")
                if "image" in ct or len(resp.content) > 1000:
                    _discovered_url = url
                    print(f"[camera] ✓ snapshot URL: {url}")
                    return resp.content
        except Exception as exc:
            print(f"[camera] HTTP {url} → {type(exc).__name__}")
            continue

    return None


def _try_rtsp_snapshot(rtsp_url: str) -> bytes | None:
    try:
        cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
        if not cap.isOpened():
            print(f"[camera] RTSP open failed: {rtsp_url}")
            return None
        ok, frame = cap.read()
        cap.release()
        if not ok or frame is None:
            print("[camera] RTSP read returned empty frame")
            return None
        _, buf = cv2.imencode(".jpg", frame)
        return buf.tobytes()
    except Exception as exc:
        print(f"[camera] RTSP exception: {exc}")
        return None


def get_camera_snapshot() -> str:
    """
    Returns:
        str: Base64 data URL  →  "data:image/jpeg;base64,<data>"
    Raises:
        HTTPException 503 if every method fails.
    """
    host     = os.getenv("IP_CAMERA_HOST",     "169.254.110.15")
    user     = os.getenv("IP_CAMERA_USER",     "admin")
    pwd      = os.getenv("IP_CAMERA_PASS",     "admin")
    rtsp_url = os.getenv("IP_CAMERA_RTSP_URL", f"rtsp://{user}:{pwd}@{host}:554/stream1")

    jpeg_bytes = _try_http_snapshot(host, user, pwd)

    if jpeg_bytes is None:
        print("[camera] All HTTP paths failed → trying RTSP via OpenCV")
        jpeg_bytes = _try_rtsp_snapshot(rtsp_url)

    if jpeg_bytes is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                f"Cannot reach IP camera at {host}. "
                "Tried all HTTP snapshot paths and RTSP. "
                "Check: 1) Camera is on same network. "
                "2) IP_CAMERA_USER / IP_CAMERA_PASS in .env are correct. "
                "3) IP_CAMERA_RTSP_URL is set correctly. "
                f"Current RTSP URL: {rtsp_url}"
            ),
        )

    b64 = base64.b64encode(jpeg_bytes).decode("utf-8")
    return f"data:image/jpeg;base64,{b64}"
