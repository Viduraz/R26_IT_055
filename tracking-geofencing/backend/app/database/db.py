from motor.motor_asyncio import AsyncIOMotorClient
import os
from dotenv import load_dotenv

load_dotenv("../../.env")
load_dotenv(".env")

_client = None

def get_client():
    global _client
    if _client is None:
        uri = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
        try:
            _client = AsyncIOMotorClient(
                uri,
                serverSelectionTimeoutMS=5000,
                connectTimeoutMS=5000,
                socketTimeoutMS=5000,
                tls=True,
                tlsAllowInvalidCertificates=True,
            )
        except Exception as e:
            print(f"[WARN] MongoDB client creation failed: {e}")
            _client = None
    return _client

def get_database():
    client = get_client()
    if client is None:
        return None
    return client["secure_elder_care"]
