"""
gateway/routes/alerts.py
Unknown-person WhatsApp alert dispatch + snapshot hosting for LiveFeedPage.

The dedup logic (deciding *whether* a given detection is a genuinely new
unknown person worth alerting on) lives client-side in LiveFeedPage.jsx —
this endpoint just handles dispatch once the frontend has already decided to
fire one, keeping the Twilio credentials server-side.
"""
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from services.notifications.whatsapp_service import send_unknown_person_alert, SNAPSHOT_DIR

router = APIRouter(prefix="/api/alerts", tags=["Alerts"])


class UnknownPersonAlertRequest(BaseModel):
    snapshot: Optional[str] = None  # data:image/jpeg;base64,...
    confidence: float = 0.0
    source: str = "Webcam"
    people_in_frame: int = 1
    detected_at: str


@router.post("/notify-unknown")
async def notify_unknown_person(req: UnknownPersonAlertRequest):
    """Send a WhatsApp alert for a newly-seen unknown person. Always returns
    200 — a missing/broken Twilio setup surfaces as {"sent": false, "reason":
    ...}, never as an error, so it can't disrupt the live feed."""
    return send_unknown_person_alert(
        snapshot_data_url=req.snapshot,
        confidence=req.confidence,
        source=req.source,
        people_in_frame=req.people_in_frame,
        detected_at=req.detected_at,
    )


@router.get("/snapshot/{filename}")
async def get_alert_snapshot(filename: str):
    """Serve a previously-saved alert snapshot. This is the URL Twilio's own
    servers fetch WhatsApp media from, so it must be reachable from the public
    internet — see PUBLIC_MEDIA_BASE_URL in .env."""
    if "/" in filename or "\\" in filename or not filename.endswith(".jpg"):
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = SNAPSHOT_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="Snapshot not found or expired")
    return FileResponse(str(path), media_type="image/jpeg")
