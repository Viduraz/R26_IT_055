"""
schedule-monitoring/backend/app/routes/monitoring_routes.py
Monitoring endpoints: detection events, today's status, logs, notifications.
"""
from fastapi import APIRouter
from typing import Optional
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
