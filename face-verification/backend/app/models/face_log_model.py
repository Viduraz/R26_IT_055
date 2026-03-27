"""
face-verification/backend/app/models/face_log_model.py
MongoDB collection accessor for face logs.
"""
from shared.backend.config.database import get_db


def face_log_collection():
    return get_db()["face_logs"]
