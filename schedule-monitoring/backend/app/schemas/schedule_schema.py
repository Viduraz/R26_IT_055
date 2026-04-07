"""
schedule-monitoring/backend/app/schemas/schedule_schema.py
Pydantic schemas for schedule validation and serialization.
"""
from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List


class ActivitySchema(BaseModel):
    activity_name: str  # wake, eat, walk, sit, sleep
    start_time: str  # HH:MM format
    end_time: str    # HH:MM format


class CreateScheduleSchema(BaseModel):
    activities: List[ActivitySchema]
    description: Optional[str] = None


class ScheduleResponseSchema(BaseModel):
    schedule_id: str
    user_id: str
    activities: List[ActivitySchema]
    description: Optional[str]
    created_at: datetime
    updated_at: datetime


class ActivityLogSchema(BaseModel):
    schedule_id: str
    activity_name: str
    expected_start: str  # HH:MM
    expected_end: str    # HH:MM
    detected_at: Optional[datetime] = None
    status: str  # "Done" / "Late" / "Missed"
    detection_confident: float = 0.0


class NotificationSchema(BaseModel):
    notification_id: str
    user_id: str
    activity_name: str
    status: str  # "Late" / "Missed"
    message: str
    created_at: datetime
    read: bool = False


class ActivityDetectionSchema(BaseModel):
    """Received from vision module when activity is detected"""
    activity_name: str
    confidence: float
    detected_at: datetime
    signals: dict  # e.g., {"posture": "sitting", "hand_movement": True, "mouth_movement": True}
