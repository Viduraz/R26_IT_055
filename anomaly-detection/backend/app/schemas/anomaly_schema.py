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
