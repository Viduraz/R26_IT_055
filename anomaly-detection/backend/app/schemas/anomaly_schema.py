"""
anomaly-detection/backend/app/schemas/anomaly_schema.py
Pydantic contracts for the Anomaly Detection API.
"""
from pydantic import BaseModel
from typing import Optional


class AnomalyProcessRequest(BaseModel):
    live_frame:   str                   # base64 JPEG/PNG webcam frame
    person_id:    Optional[str] = None  # patient or tracked person id
    caregiver_id: Optional[str] = None  # verified caregiver from face-verification
    session_id:   Optional[str] = None  # tracking session id from tracking service
    timestamp:    Optional[str] = None  # ISO8601 — uses server time if omitted


class AnomalyStatusRequest(BaseModel):
    person_id: str


class CameraProcessRequest(BaseModel):
    """
    Used by /camera-process endpoint — the backend fetches the frame
    from the IP camera itself; the client only needs to supply context.
    """
    person_id:    Optional[str] = None
    caregiver_id: Optional[str] = None
    session_id:   Optional[str] = None
    timestamp:    Optional[str] = None
