"""
schedule-monitoring/backend/app/routes/monitoring_routes.py
Monitoring endpoints: detection events, today's status, logs, notifications.
"""
from fastapi import APIRouter
from typing import Optional, List
from pydantic import BaseModel
from datetime import datetime
from app.controllers.monitoring_controller import (
    handle_detection_event,
    get_today_status,
    get_activity_logs,
    get_notifications,
    mark_notification_read,
    mark_all_notifications_read,
    trigger_missed_evaluation,
)
from app.services.activity_service import get_activity_service

router = APIRouter()


class DetectionEventPayload(BaseModel):
    patient_id: str = "patient_001"
    detected_activity: str          # "eating" | "sleeping" | "walking" | "medication" | …
    timestamp: Optional[datetime] = None
    confidence: float = 0.0
    caregiver_present: bool = False
    caregiver_id: Optional[str] = None


@router.post("/detection-event", summary="Receive a vision detection event")
async def _detection(payload: DetectionEventPayload):
    return await handle_detection_event(payload.model_dump())


@router.get("/today/{patient_id}", summary="Get today's monitoring status for a patient")
async def _today(patient_id: str):
    return await get_today_status(patient_id)


@router.get("/logs/{patient_id}", summary="Get full activity log history")
async def _logs(patient_id: str):
    return await get_activity_logs(patient_id)


@router.get("/notifications/{patient_id}", summary="Get notifications for family")
async def _notifications(patient_id: str):
    return await get_notifications(patient_id)


@router.put("/notifications/{notification_id}/read", summary="Mark a notification as read")
async def _mark_read(notification_id: str):
    return await mark_notification_read(notification_id)


@router.put("/notifications/{patient_id}/read-all", summary="Mark all notifications read")
async def _mark_all_read(patient_id: str):
    return await mark_all_notifications_read(patient_id)


@router.post("/evaluate-missed/{patient_id}", summary="Manually trigger missed-task evaluation")
async def _evaluate_missed(patient_id: str):
    return await trigger_missed_evaluation(patient_id)


# ── Random Forest Activity Detection ────────────────────────────────────────

class RFPredictionPayload(BaseModel):
    """Payload for Random Forest activity prediction"""
    features: List[float]  # 15 pose features


@router.post("/predict-rf", summary="Predict activity using Random Forest model")
async def predict_activity_rf(payload: RFPredictionPayload):
    """
    Predict activity from 15 pose features using the trained Random Forest model.
    
    **Features (15 total):**
    0. shoulder_angle
    1. elbow_angle_left
    2. elbow_angle_right
    3. hip_angle
    4. knee_angle_left
    5. knee_angle_right
    6. arm_raise_left
    7. arm_raise_right
    8. hand_to_mouth
    9. hand_to_face
    10. arm_velocity
    11. leg_velocity
    12. torso_lean
    13. body_symmetry
    14. hand_height
    
    **Response:**
    - `activity`: Predicted activity name (Walking, Sitting/rest, Sleeping, Eating, Drinking)
    - `confidence`: Confidence score from 0-1
    - `model_ready`: Whether the model is loaded and ready
    """
    service = get_activity_service()
    
    if not service.is_model_loaded():
        return {
            "activity": None,
            "confidence": 0.0,
            "model_ready": False,
            "error": "Random Forest model not loaded. Ensure rf_model.pkl is in app/models/"
        }
    
    try:
        activity, confidence = service.predict_activity(payload.features)
        return {
            "activity": activity,
            "confidence": confidence,
            "model_ready": True
        }
    
    except ValueError as e:
        return {
            "activity": None,
            "confidence": 0.0,
            "model_ready": True,
            "error": str(e)
        }
