"""
anomaly-detection/backend/app/routes/anomaly_routes.py
"""
from fastapi import APIRouter, Depends
from app.controllers.anomaly_controller import run_detection, get_history, get_model_status
from app.middleware.verify_token import get_current_user

router = APIRouter()


@router.post("/detect", summary="Run pose-based anomaly detection on a frame")
async def _detect(user=Depends(get_current_user)):
    return await run_detection(user)


@router.get("/history", summary="Anomaly detection history")
async def _history(user=Depends(get_current_user)):
    return await get_history(user)


@router.get("/model-status", summary="ML model status")
async def _model_status(user=Depends(get_current_user)):
    return await get_model_status(user)
