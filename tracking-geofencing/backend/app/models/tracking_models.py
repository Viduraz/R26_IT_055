from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime


# ── Tracking Models ──────────────────────────────────────────────

class BoundingBox(BaseModel):
    x: float
    y: float
    w: float
    h: float


class DetectedPerson(BaseModel):
    person_id: str
    bbox: BoundingBox
    confidence: float
    timestamp: str


class ProcessFrameRequest(BaseModel):
    frame: str = Field(..., description="Base64-encoded JPEG frame")
    elder_id: Optional[str] = None


class ProcessFrameResponse(BaseModel):
    frame_id: str
    detections: List[DetectedPerson]
    total_persons: int
    timestamp: str


class TrackingLogEntry(BaseModel):
    person_id: str
    bounding_box: dict
    confidence: float
    zone_status: Optional[str] = "unknown"
    timestamp: str
    frame_id: str


class TrackingStatsResponse(BaseModel):
    total_tracked_today: int
    active_now: int
    alerts_today: int
    zones_configured: int


class TrackingHistoryResponse(BaseModel):
    logs: List[dict]
    total: int
    page: int
    page_size: int


class ActiveTrackingResponse(BaseModel):
    active_persons: List[DetectedPerson]
    count: int


# ── Geofencing Models ────────────────────────────────────────────

class ZoneCreateRequest(BaseModel):
    name: str
    zone_type: str = Field(..., pattern="^(safe|restricted|alert)$")
    polygon: List[List[float]] = Field(..., min_length=3)
    color: Optional[str] = "#00D4FF"


class ZoneUpdateRequest(BaseModel):
    name: Optional[str] = None
    zone_type: Optional[str] = None
    polygon: Optional[List[List[float]]] = None
    color: Optional[str] = None
    is_active: Optional[bool] = None


class ZoneResponse(BaseModel):
    zone_id: str
    name: str
    zone_type: str
    polygon: List[List[float]]
    color: str
    is_active: bool
    created_at: str


class BreachCheckRequest(BaseModel):
    person_id: str
    x: float
    y: float


class BreachCheckResponse(BaseModel):
    person_id: str
    breaches: List[dict]
    is_breached: bool


class AlertResponse(BaseModel):
    alert_id: str
    person_id: str
    zone_id: str
    zone_name: str
    breach_type: str
    timestamp: str
    resolved: bool
