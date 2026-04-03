"""
anomaly-detection/backend/app/routes/anomaly_routes.py
"""
from fastapi import APIRouter
from app.controllers.anomaly_controller import process_frame, get_history, get_model_status
from app.schemas.anomaly_schema import AnomalyProcessRequest

router = APIRouter()


@router.post("/process", summary="Run full anomaly detection pipeline on a live frame")
async def _process(payload: AnomalyProcessRequest):
    return await process_frame(payload)


@router.get("/history", summary="Anomaly detection event history (last 100)")
async def _history():
    return await get_history()


@router.get("/model-status", summary="ML model weights + pipeline status")
async def _model_status():
    return await get_model_status()


@router.get("/health", summary="Service health check")
def _health():
    return {"status": "ok", "service": "anomaly-detection"}
