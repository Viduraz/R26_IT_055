"""
caregiver-marketplace/backend/app/schemas/caregiver_schema.py
Pydantic models for caregiver search and profile updates.
"""
from pydantic import BaseModel, Field
from typing import Optional, List


class CaregiverSearchQuery(BaseModel):
    """Query parameters for searching caregivers."""
    specialization: Optional[str] = None
    min_rating: Optional[float] = None
    max_hourly_rate: Optional[float] = None
    service_area: Optional[str] = None
    language: Optional[str] = None
    page: int = Field(default=1, ge=1)
    limit: int = Field(default=20, ge=1, le=50)


class AvailabilitySlot(BaseModel):
    start: str  # "08:00"
    end: str    # "20:00"


class CaregiverProfileUpdate(BaseModel):
    """Fields a caregiver can update on their marketplace profile."""
    bio: Optional[str] = None
    specializations: Optional[List[str]] = None
    hourly_rate: Optional[float] = None
    languages: Optional[List[str]] = None
    availability: Optional[dict] = None
    service_area: Optional[str] = None
    profile_photo_url: Optional[str] = None


class CaregiverPublicProfile(BaseModel):
    """Public-facing caregiver profile returned by the API."""
    model_config = {"extra": "ignore"}  # silently drop unknown DB fields

    id: str
    # name/email Optional — users registered before marketplace may lack these
    name: Optional[str] = ""
    email: Optional[str] = ""
    bio: Optional[str] = None
    specializations: Optional[List[str]] = None
    hourly_rate: Optional[float] = None
    languages: Optional[List[str]] = None
    availability: Optional[dict] = None
    service_area: Optional[str] = None
    profile_photo_url: Optional[str] = None
    rating: Optional[float] = 0.0
    total_reviews: Optional[int] = 0
    face_verification_status: Optional[str] = None
    verification_status: Optional[str] = "pending"   # admin-controlled field
    caregiver_license_or_staff_id: Optional[str] = None
    contact_number: Optional[str] = None
    created_at: Optional[str] = None

