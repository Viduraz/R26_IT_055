"""
face-verification/backend/app/models/face_log_model.py
MongoDB accessor for tracking audit logs of biometric attempts.
"""
from shared.backend.config.database import get_db

def face_log_collection():
    return get_db()["face_verification_logs"]
