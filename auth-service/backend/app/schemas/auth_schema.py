"""
auth-service/backend/app/schemas/auth_schema.py
Pydantic request/response models for the Auth Service.
"""
from pydantic import BaseModel, EmailStr, Field
from typing import Literal, Optional, List


class RegisterRequest(BaseModel):
    # Core Fields
    name: str = Field(..., alias="full_name")  # Frontend might send full_name
    email: EmailStr
    password: str
    role: Literal["admin", "caregiver", "family_member"] = "family_member"

    # Common Profile Fields (Optional default, but validated based on role in service)
    id_number: Optional[str] = None
    contact_number: Optional[str] = None
    date_of_birth: Optional[str] = None
    gender: Optional[str] = None
    
    # Address
    permanent_address: Optional[str] = None
    office_address: Optional[str] = None

    # Elder relationship & Emergency
    relationship_to_elder: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_number: Optional[str] = None
    
    # Caregiver specific
    caregiver_license_or_staff_id: Optional[str] = None
    
    # Biometric enrollment (Caregiver only)
    # Expected to be a list of base64 encoded image strings representing the face
    face_samples: Optional[List[str]] = None
    
    class Config:
        populate_by_name = True


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class FaceLoginRequest(BaseModel):
    email: EmailStr
    password: str
    live_face_sample: str  # Base64 image


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: str
    name: str
    email: str
    role: str
    face_verification_status: Optional[str] = None
