"""
anomaly-detection/backend/app/models/anomaly_log_model.py
"""
from shared.backend.config.database import get_db


def anomaly_log_collection():
    return get_db()["anomaly_logs"]
