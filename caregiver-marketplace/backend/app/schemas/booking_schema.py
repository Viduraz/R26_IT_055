"""
caregiver-marketplace/backend/app/schemas/booking_schema.py
Pydantic models for the booking flow.
"""
from pydantic import BaseModel, Field
from typing import Optional, List


class ElderProfile(BaseModel):
    """Details about the elder being cared for."""
    name: str
    age: int = Field(..., ge=1, le=150)
    gender: Optional[str] = None
    medical_conditions: Optional[List[str]] = None
    mobility: Optional[str] = None
    care_needs: Optional[List[str]] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_number: Optional[str] = None
    address: Optional[str] = None


class BookingSchedule(BaseModel):
    """Requested care schedule."""
    start_date: str       # "2026-07-01"
    end_date: str         # "2026-07-31"
    days: List[str]       # ["monday", "wednesday", "friday"]
    start_time: str       # "09:00"
    end_time: str         # "17:00"


class CreateBookingRequest(BaseModel):
    """Request body for creating a new booking."""
    caregiver_user_id: str
    elder: ElderProfile
    schedule: BookingSchedule
    notes: Optional[str] = None
    # Notification preferences
    notify_email: bool = True
    notify_sms: bool = False
    family_phone: Optional[str] = None  # Required if notify_sms=True


class BookingResponse(BaseModel):
    """Response after creating a booking."""
    booking_id: str
    patient_id: str
    caregiver_name: str
    elder_name: str
    status: str
    schedule: dict
    total_amount: Optional[float] = None
    message: str


class ResendPatientIdRequest(BaseModel):
    """Request to resend the patient ID notification."""
    via_email: bool = True
    via_sms: bool = False
    phone_override: Optional[str] = None
