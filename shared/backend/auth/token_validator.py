"""
shared/backend/auth/token_validator.py
FastAPI dependency for validating Bearer JWT tokens on protected routes.
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from jwt.exceptions import ExpiredSignatureError, InvalidTokenError

from shared.backend.auth.jwt_handler import decode_access_token

_bearer = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> dict:
    """
    FastAPI dependency: validate JWT and return the decoded payload.

    Usage:
        @router.get("/protected")
        def protected(user = Depends(get_current_user)):
            return {"user": user}
    """
    token = credentials.credentials
    try:
        payload = decode_access_token(token)
        return payload
    except ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
