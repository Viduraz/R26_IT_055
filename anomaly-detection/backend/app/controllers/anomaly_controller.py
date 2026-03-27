"""
anomaly-detection/backend/app/controllers/anomaly_controller.py
"""
from app.services.anomaly_service import AnomalyService

_svc = AnomalyService()


async def run_detection(user: dict):
    return await _svc.run_pipeline(user_id=user.get("sub"))


async def get_history(user: dict):
    return await _svc.fetch_logs()


async def get_model_status(user: dict):
    return {
        "mediapipe": "loaded",
        "lstm": "todo",
        "autoencoder": "todo",
    }
