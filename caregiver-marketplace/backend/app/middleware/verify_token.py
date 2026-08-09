"""
caregiver-marketplace/backend/app/middleware/verify_token.py
Re-exports the shared JWT dependency so route files can do a simple local import.
"""
from shared.backend.auth.token_validator import get_current_user  # noqa: F401
