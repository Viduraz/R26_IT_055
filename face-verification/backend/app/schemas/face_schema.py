"""
face-verification/backend/app/schemas/face_schema.py
"""
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class VerificationRequest(BaseModel):
    frame_b64: str  # base64-encoded JPEG/PNG frame


class VerificationResponse(BaseModel):
    match: bool
    person_id: Optional[str] = None
    confidence: float
    timestamp: datetime = None


class FaceLogEntry(BaseModel):
    user_id: str
    status: str
    match: Optional[bool] = None
    confidence: float = 0.0
    timestamp: datetime
