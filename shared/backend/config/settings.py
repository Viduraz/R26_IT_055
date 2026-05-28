"""
shared/backend/config/settings.py
Centralised settings loaded from the root .env file.
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# Walk up the directory tree to find the root .env
_ROOT = Path(__file__).resolve().parents[3]  # shared/backend/config -> root
load_dotenv(_ROOT / ".env")


class Settings:
    # MongoDB
    MONGODB_URI: str = os.getenv("MONGODB_URI", "")
    MONGODB_DB_NAME: str = os.getenv("MONGODB_DB_NAME", "secure_elder_care")

    # JWT
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "change_this_secret")
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
    JWT_EXPIRE_MINUTES: int = int(os.getenv("JWT_EXPIRE_MINUTES", "60"))

    # Service URLs
    AUTH_SERVICE_URL: str = os.getenv("AUTH_SERVICE_URL", "http://localhost:8000")
    FACE_SERVICE_URL: str = os.getenv("FACE_SERVICE_URL", "http://localhost:8001")
    TRACKING_SERVICE_URL: str = os.getenv("TRACKING_SERVICE_URL", "http://localhost:8002")
    ANOMALY_SERVICE_URL: str = os.getenv("ANOMALY_SERVICE_URL", "http://localhost:8003")
    SCHEDULE_SERVICE_URL: str = os.getenv("SCHEDULE_SERVICE_URL", "http://localhost:8004")
    GATEWAY_SERVICE_URL: str = os.getenv("GATEWAY_SERVICE_URL", "http://localhost:8005")


settings = Settings()
