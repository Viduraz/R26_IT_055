"""
auth-service/backend/app/models/user_model.py
MongoDB collection accessor for users.
"""
from shared.backend.config.database import get_db


def user_collection():
    return get_db()["users"]
