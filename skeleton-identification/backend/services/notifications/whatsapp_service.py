"""
services/notifications/whatsapp_service.py
Sends a WhatsApp alert (via Twilio) when the live-feed multi-person pipeline
flags an unrecognized person. Mirrors the credential-reading pattern already
used for SMS in caregiver-marketplace/backend/app/services/notification_service.py.

Twilio's WhatsApp media messages require an image URL its own servers can
fetch — a localhost URL doesn't work. If PUBLIC_MEDIA_BASE_URL isn't set to a
publicly reachable address (a tunnel, a deployed host), alerts still send as
text-only rather than failing outright.
"""
import base64
import os
import time
import uuid
from pathlib import Path
from typing import Optional

import structlog

log = structlog.get_logger()

SNAPSHOT_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "alert_snapshots"
SNAPSHOT_RETENTION_S = 24 * 3600  # best-effort housekeeping — delete snapshots older than this on each save


def _save_snapshot(data_url: str) -> Optional[str]:
    """Decode a data:image/...;base64,... string to disk. Returns the saved
    filename, or None if the input wasn't decodable."""
    try:
        raw = data_url.split(",", 1)[1] if "," in data_url else data_url
        image_bytes = base64.b64decode(raw)
    except Exception as e:
        log.warning("alert_snapshot_decode_failed", error=str(e))
        return None

    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.jpg"
    (SNAPSHOT_DIR / filename).write_bytes(image_bytes)

    try:
        now = time.time()
        for f in SNAPSHOT_DIR.glob("*.jpg"):
            if now - f.stat().st_mtime > SNAPSHOT_RETENTION_S:
                f.unlink(missing_ok=True)
    except Exception:
        pass  # housekeeping only — never let cleanup failures block an alert

    return filename


def send_unknown_person_alert(
    snapshot_data_url: Optional[str],
    confidence: float,
    source: str,
    people_in_frame: int,
    detected_at: str,
) -> dict:
    """Best-effort WhatsApp alert for a newly-seen unrecognized person.

    Never raises — a missing/incomplete Twilio setup must never break the
    live feed itself. Returns {"sent": bool, "reason"?: str, "with_image"?: bool}.
    """
    sid = os.getenv("TWILIO_SID", "")
    auth = os.getenv("TWILIO_AUTH", "")
    from_number = os.getenv("TWILIO_WHATSAPP_FROM", "").strip()
    to_number = os.getenv("ALERT_WHATSAPP_TO", "").strip()

    if not sid or not auth or not from_number or not to_number:
        log.info("whatsapp_alert_skipped", reason="twilio_not_configured")
        return {
            "sent": False,
            "reason": "Twilio WhatsApp not configured — set TWILIO_SID, TWILIO_AUTH, "
                      "TWILIO_WHATSAPP_FROM and ALERT_WHATSAPP_TO in .env",
        }

    body = (
        "🚨 SecureElderCare Alert\n\n"
        "Unregistered person detected.\n"
        f"Time: {detected_at}\n"
        f"Camera: {source}\n"
        f"People in frame: {people_in_frame}\n\n"
        "Please check the live feed."
    )

    media_url = None
    if snapshot_data_url:
        filename = _save_snapshot(snapshot_data_url)
        if filename:
            public_base = os.getenv("PUBLIC_MEDIA_BASE_URL", "").strip().rstrip("/")
            if public_base:
                media_url = f"{public_base}/api/alerts/snapshot/{filename}"
            else:
                log.info(
                    "whatsapp_alert_text_only",
                    reason="PUBLIC_MEDIA_BASE_URL not set — Twilio can't fetch a localhost image",
                )

    try:
        from twilio.rest import Client
    except ImportError:
        log.warning("whatsapp_alert_skipped", reason="twilio_package_not_installed")
        return {"sent": False, "reason": "twilio package not installed — pip install twilio"}

    def _as_whatsapp(number: str) -> str:
        return number if number.startswith("whatsapp:") else f"whatsapp:{number}"

    try:
        client = Client(sid, auth)
        kwargs = {"body": body, "from_": _as_whatsapp(from_number), "to": _as_whatsapp(to_number)}
        if media_url:
            kwargs["media_url"] = [media_url]
        client.messages.create(**kwargs)
        log.info("whatsapp_alert_sent", to=to_number, with_image=bool(media_url))
        return {"sent": True, "with_image": bool(media_url)}
    except Exception as e:
        log.error("whatsapp_alert_failed", error=str(e))
        return {"sent": False, "reason": str(e)}
