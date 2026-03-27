"""
tracking-geofencing/backend/app/schemas/tracking_schema.py
Pydantic contracts for caregiver geofencing APIs.
"""
from pydantic import BaseModel

class SessionHandoffRequest(BaseModel):
    session_id: str
    caregiver_id: str
    caregiver_name: str
    verified_at: str
    status: str
    track_id: str | None = None
    last_seen_at: str

class TrackVisibilityRequest(BaseModel):
    session_id: str
    live_frame: str | None = None  # Base64 webcam frame to run through MediaPipe
