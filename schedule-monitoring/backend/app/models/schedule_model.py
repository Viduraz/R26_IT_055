"""
schedule-monitoring/backend/app/models/schedule_model.py
Pydantic request/response models for schedule monitoring.
"""
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from app.models.enums import TaskType, TaskStatus, Priority


class ScheduleItem(BaseModel):
    patient_id: str = "patient_001"
    task_name: str
    task_type: TaskType
    start_time: str          # "HH:MM" 24-hour
    end_time: str            # "HH:MM" 24-hour
    repeat_days: List[str] = []   # ["Mon", "Tue", ...] — empty means every day
    caregiver_required: bool = False
    priority: Priority = Priority.MEDIUM
    active: bool = True


class ScheduleUpdateItem(BaseModel):
    patient_id: Optional[str] = None
    task_name: Optional[str] = None
    task_type: Optional[TaskType] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    repeat_days: Optional[List[str]] = None
    caregiver_required: Optional[bool] = None
    priority: Optional[Priority] = None
    active: Optional[bool] = None


class DetectionEvent(BaseModel):
    patient_id: str = "patient_001"
    detected_activity: str   # "eating", "sleeping", "walking", "medication", etc.
    timestamp: Optional[datetime] = None
    confidence: float = 0.0
    caregiver_present: bool = False
    caregiver_id: Optional[str] = None
