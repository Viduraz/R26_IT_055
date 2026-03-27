"""
face-verification/backend/app/schemas/face_schema.py
Pydantic schemas for face enrollment and verification endpoints.
"""
from pydantic import BaseModel, Field
from typing import List


class EnrollFaceRequest(BaseModel):
    # Expects 5-10 base64 images
    samples: List[str] = Field(..., min_length=1, description="List of base64 encoded face images")


class EnrollFaceResponse(BaseModel):
    message: str
    embedding: List[float]
    processed_samples: int


class VerifyFaceRequest(BaseModel):
    live_sample: str
    stored_embedding: List[float]


class VerifyFaceResponse(BaseModel):
    matched: bool
    similarity: float
    confidence: float

class VerifyCaregiverRequest(BaseModel):
    live_sample: str

class CaregiverSessionModel(BaseModel):
    session_id: str
    caregiver_id: str
    caregiver_name: str
    verified_at: str
    status: str
    track_id: str | None = None
    last_seen_at: str

class VerifyCaregiverResponse(BaseModel):
    verified: bool
    message: str
    similarity: float = 0.0
    confidence: float = 0.0
    caregiver_details: dict | None = None
    session: CaregiverSessionModel | None = None

