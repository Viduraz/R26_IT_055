"""
anomaly-detection/backend/app/controllers/anomaly_controller.py
"""
from app.services.anomaly_service import AnomalyService
from app.schemas.anomaly_schema   import AnomalyProcessRequest

_svc = AnomalyService()


async def process_frame(payload: AnomalyProcessRequest):
    return await _svc.process_frame(payload)


async def get_history():
    return await _svc.fetch_logs()


async def get_model_status():
    return await _svc.get_status()
