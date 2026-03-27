"""
face-verification/backend/app/services/alert_service.py
Trigger alerts for unauthorized face detections.
"""
from datetime import datetime
from shared.backend.config.database import get_db


def _alerts():
    return get_db()["face_alerts"]


def send_alert(person_id: str, confidence: float, snapshot_b64: str = "") -> dict:
    """
    TODO: Integrate with notification service (WebSocket / email / SMS).
    """
    alert = {
        "type": "unauthorized_face",
        "person_id": person_id,
        "confidence": confidence,
        "snapshot_b64": snapshot_b64,
        "timestamp": datetime.utcnow(),
    }
    _alerts().insert_one(alert)
    return alert
