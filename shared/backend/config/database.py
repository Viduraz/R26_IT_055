"""
shared/backend/config/database.py
Creates a reusable PyMongo client and returns the project database.
"""
from pymongo import MongoClient
from pymongo.database import Database
from .settings import settings

_client: MongoClient | None = None


def get_db() -> Database:
    """Return the shared MongoDB database instance (singleton)."""
    global _client
    if _client is None:
        _client = MongoClient(settings.MONGODB_URI)
    return _client[settings.MONGODB_DB_NAME]


def close_db() -> None:
    """Close the MongoDB connection (call on app shutdown)."""
    global _client
    if _client is not None:
        _client.close()
        _client = None
