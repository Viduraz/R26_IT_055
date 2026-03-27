"""
auth-service/backend/app/services/password_service.py
Native bcrypt password hashing without passlib wrapper.
"""
import bcrypt


def hash_password(plain: str) -> str:
    """Hashes a password using bcrypt."""
    salt = bcrypt.gensalt()
    # hashpw requires bytes, so we encode the string
    hashed_bytes = bcrypt.hashpw(plain.encode('utf-8'), salt)
    return hashed_bytes.decode('utf-8')


def verify_password(plain: str, hashed: str) -> bool:
    """Verifies a plain password against the hashed version."""
    return bcrypt.checkpw(plain.encode('utf-8'), hashed.encode('utf-8'))
