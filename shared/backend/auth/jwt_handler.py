"""
shared/backend/auth/jwt_handler.py
Utility to create and decode JWT tokens.
"""
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from jwt.exceptions import ExpiredSignatureError, InvalidTokenError

from shared.backend.config.settings import settings


def create_access_token(data: dict[str, Any]) -> str:
    """
    Create a signed JWT access token.

    Args:
        data: Payload to encode (e.g. {"sub": user_id, "email": email}).

    Returns:
        Encoded JWT string.
    """
    payload = data.copy()
    expire = datetime.now(tz=timezone.utc) + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    payload.update({"exp": expire, "iat": datetime.now(tz=timezone.utc)})
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    """
    Decode and verify a JWT access token.

    Args:
        token: Raw JWT string.

    Returns:
        Decoded payload dict.

    Raises:
        ExpiredSignatureError: If the token has expired.
        InvalidTokenError: If the token is invalid or tampered.
    """
    return jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
