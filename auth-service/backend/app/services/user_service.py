"""
auth-service/backend/app/services/user_service.py
CRUD operations for the users collection.
"""
from bson import ObjectId

from shared.backend.config.database import get_db


def _users():
    return get_db()["users"]


class UserService:
    async def get_by_email(self, email: str) -> dict | None:
        return _users().find_one({"email": email})

    async def get_by_id(self, user_id: str) -> dict | None:
        try:
            return _users().find_one({"_id": ObjectId(user_id)})
        except Exception:
            return None
