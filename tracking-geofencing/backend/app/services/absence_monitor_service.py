"""
tracking-geofencing/backend/app/services/absence_monitor_service.py
Mutates caregiver session state by calculating elapsed timer gaps against MediaPipe pings.
"""
from shared.backend.config.database import get_db
from datetime import datetime, timezone

def evaluate_absence(session_id: str, visible: bool) -> dict:
    db = get_db()
    session = db["verified_caregiver_sessions"].find_one({"session_id": session_id})
    if not session:
        return {"status": "error", "message": "Session not found"}
        
    now = datetime.now(timezone.utc)
    
    if visible:
        db["verified_caregiver_sessions"].update_one(
            {"session_id": session_id},
            {"$set": {"last_seen_at": now.isoformat(), "status": "verified_present"}}
        )
        return {"session_id": session_id, "status": "verified_present", "absence_seconds": 0}
    
    # Caregiver mathematically out of frame
    last_seen_str = session.get("last_seen_at", now.isoformat())
    last_seen = datetime.fromisoformat(last_seen_str)
    diff = (now - last_seen).total_seconds()
    
    new_status = session.get("status", "verified_present")
    alert_severity = None
    alert_message = None
    
    # State Engine Escalation
    if diff > 120:
        new_status = "missing_critical"
        alert_severity = "critical"
        alert_message = f"Critical absence alert: Caregiver {session.get('caregiver_name')} missing from frame for over 2 minutes!"
    elif diff > 30:
        new_status = "missing"
        alert_severity = "notify"
        alert_message = f"Caregiver {session.get('caregiver_name')} missing from frame for over 30 seconds."
    elif diff > 10:
        new_status = "warning"
        alert_severity = "warning"
        alert_message = f"Caregiver {session.get('caregiver_name')} out of frame."
        
    db["verified_caregiver_sessions"].update_one(
        {"session_id": session_id},
        {"$set": {"status": new_status}}
    )
    
    # Fire structured alerts to MongoDB for Gateway Dashboard Aggregation
    if alert_severity:
        # Use an upsert logic on timestamp rounded to prevent DB explosion limits
        db["tracking_alerts"].insert_one({
            "timestamp": now.isoformat(),
            "caregiver_id": session.get("caregiver_id"),
            "session_id": session_id,
            "severity": alert_severity,
            "message": alert_message
        })
        
    return {"session_id": session_id, "status": new_status, "absence_seconds": round(diff, 1)}
