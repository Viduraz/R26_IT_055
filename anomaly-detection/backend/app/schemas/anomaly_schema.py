"""
anomaly-detection/backend/app/schemas/anomaly_schema.py
"""
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class AnomalyLogEntry(BaseModel):
    user_id: str
    anomaly_detected: bool
    confidence: float
    event_type: str
    timestamp: datetime


class AnomalyResponse(BaseModel):
    anomaly_detected: bool
    confidence: float
    event_type: Optional[str] = None
