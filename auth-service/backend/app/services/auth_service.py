"""
auth-service/backend/app/services/auth_service.py
Core authentication business logic.
"""
from datetime import datetime

from fastapi import HTTPException, status

from app.models.user_model import user_collection
from app.schemas.auth_schema import RegisterRequest, LoginRequest
from app.services.password_service import hash_password, verify_password
from app.services.user_service import UserService
from shared.backend.auth.jwt_handler import create_access_token


class AuthService:
    def __init__(self):
        self._user_service = UserService()

    async def register(self, payload: RegisterRequest) -> dict:
        # Check for duplicate email
        existing = await self._user_service.get_by_email(payload.email)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Email already registered.",
            )

        hashed_pw = hash_password(payload.password)
        user_doc = {
            "name": payload.name,
            "email": payload.email,
            "password_hash": hashed_pw,
            "role": payload.role,
            "created_at": datetime.utcnow(),
        }
        result = user_collection().insert_one(user_doc)
        return {"message": "User registered successfully.", "user_id": str(result.inserted_id)}

    async def login(self, payload: LoginRequest) -> dict | None:
        user = await self._user_service.get_by_email(payload.email)
        if not user or not verify_password(payload.password, user["password_hash"]):
            return None

        token = create_access_token({"sub": str(user["_id"]), "email": user["email"], "role": user.get("role", "user")})
        return {"access_token": token, "token_type": "bearer"}
