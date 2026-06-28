"""
schedule-monitoring/backend/app/schemas/schedule_schema.py
Pydantic schemas for schedule validation and serialization.
"""

from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List, Dict


class ActivitySchema(BaseModel):
    activity_name: str
    start_time: str   # HH:MM
    end_time: str     # HH:MM


class CreateScheduleSchema(BaseModel):
    activities: List[ActivitySchema]
    description: Optional[str] = None


class ScheduleResponseSchema(BaseModel):
    schedule_id: str
    user_id: str
    activities: List[ActivitySchema]
    description: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class ActivityLogSchema(BaseModel):
    """Updated to support Adaptive Thresholds"""
    schedule_id: str
    user_id: Optional[str] = None
    activity_name: str
    expected_start: str
    expected_end: Optional[str] = None
    detected_at: Optional[datetime] = None
    status: str                    # "Done", "Late", "Missed"
    
    # === New Adaptive Fields ===
    adaptive_grace_minutes: Optional[int] = None
    delay_minutes: Optional[float] = None
    deadline: Optional[str] = None     # ISO datetime string
    
    detection_confidence: Optional[float] = 0.0
    status_confidence: Optional[float] = None
    
    signals: Optional[Dict] = {}
    created_at: Optional[datetime] = None


class NotificationSchema(BaseModel):
    notification_id: str
    user_id: str
    activity_name: str
    status: str                    # "Late", "Missed"
    message: str
    created_at: datetime
    read: bool = False


class ActivityDetectionSchema(BaseModel):
    """Schema received from frontend ML vision module"""
    activity_name: str
    confidence: float
    detected_at: datetime
    signals: Dict = {}


# Optional: Response schema for validation endpoint
class ActivityValidationResponse(BaseModel):
    status: str
    adaptive_grace_minutes: int
    delay_minutes: float
    confidence: float
    deadline: str