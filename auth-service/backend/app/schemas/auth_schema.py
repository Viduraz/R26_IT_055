"""
auth-service/backend/app/schemas/auth_schema.py
Pydantic request/response models for the Auth Service.
"""
from pydantic import BaseModel, EmailStr
from typing import Literal


class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: Literal["admin", "caregiver", "family"] = "family"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    name: str
    email: str
    role: str
