"""
tracking-geofencing/backend/app/services/tracking_service.py
Orchestrates YOLOv8 detection + ByteTrack + geofence logic.
"""
from datetime import datetime
from shared.backend.config.database import get_db
from app.ml_services.inference.skeleton_tracker import SkeletonTracker
from app.services.absence_monitor_service import evaluate_absence
from app.schemas.tracking_schema import SessionHandoffRequest, TrackVisibilityRequest

class TrackingService:
    async def start_caregiver_session(self, payload: SessionHandoffRequest) -> dict:
        db = get_db()
        # Just an acknowledgment since face_service already stored it into MongoDB.
        # This gives tracking-geofencing an opportunity to initialize purely local states if needed.
        return {"message": f"Session {payload.session_id} ingested by Tracking Service"}

    async def update_visibility(self, payload: TrackVisibilityRequest) -> dict:
        detection = {"present": False, "bbox": None, "confidence": None, "keypoints": None}

        if payload.live_frame:
            # Full detection: YOLO bbox + MediaPipe skeleton keypoints
            detection = SkeletonTracker.detect_with_bbox(payload.live_frame)

        evaluation = evaluate_absence(payload.session_id, detection["present"])

        # Merge bbox, confidence, and keypoints into the response for the frontend
        evaluation["bbox"]       = detection["bbox"]
        evaluation["confidence"] = detection["confidence"]
        evaluation["keypoints"]  = detection["keypoints"]
        return evaluation

    async def get_caregiver_status(self, session_id: str) -> dict:
        db = get_db()
        session = db["verified_caregiver_sessions"].find_one({"session_id": session_id}, {"_id": 0})
        if session:
            return session
        return {"status": "error", "message": "Unknown tracking window"}

    async def list_zones(self) -> list:
        return list(get_db()["zones"].find({}, {"_id": 0}))

    async def get_history(self) -> list:
        return list(get_db()["tracking_logs"].find({}, {"_id": 0}).sort("timestamp", -1).limit(50))
