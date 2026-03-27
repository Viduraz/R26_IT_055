"""
auth-service/backend/app/controllers/auth_controller.py
Handles HTTP layer: request validation, calling services, shaping responses.
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.schemas.auth_schema import RegisterRequest, LoginRequest, TokenResponse, UserResponse
from app.services.auth_service import AuthService

_bearer = HTTPBearer()
_auth_service = AuthService()


async def register_user(payload: RegisterRequest):
    result = await _auth_service.register(payload)
    return result


async def login_user(payload: LoginRequest):
    result = await _auth_service.login(payload)
    if not result:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials.",
        )
    return result


async def get_profile(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
):
    from app.services.user_service import UserService
    from shared.backend.auth.jwt_handler import decode_access_token
    payload = decode_access_token(credentials.credentials)
    user = await UserService().get_by_id(payload.get("sub"))
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    return UserResponse(**user)
