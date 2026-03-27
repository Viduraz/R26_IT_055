"""
face-verification/backend/app/services/session_service.py
Coordinates verified sessions and hands them off to tracking-geofencing via internal orchestration.
"""
import uuid
import httpx
from datetime import datetime, timezone
from shared.backend.config.database import get_db
from shared.backend.config.settings import settings

class SessionService:
    @staticmethod
    def create_and_handoff_session(caregiver_id: str, caregiver_name: str) -> dict:
        session_id = str(uuid.uuid4())
        now_str = datetime.now(timezone.utc).isoformat()
        
        session_data = {
            "session_id": session_id,
            "caregiver_id": caregiver_id,
            "caregiver_name": caregiver_name,
            "verified_at": now_str,
            "status": "verified_present",
            "track_id": None,
            "last_seen_at": now_str
        }
        
        db = get_db()
        # Persist standard verified session 
        db["verified_caregiver_sessions"].insert_one(session_data)
        
        # Fire-and-forget handoff to tracking-geofencing architecture
        try:
            url = f"{settings.TRACKING_SERVICE_URL}/api/tracking/start-caregiver-session"
            r = httpx.post(url, json=session_data, timeout=10.0)
            if r.status_code >= 400:
                print(f"[ERROR] Session Handoff Failed ({r.status_code}): {r.text}")
        except Exception as e:
            print(f"[ERROR] Tracking Service Unreachable, cannot handoff session: {repr(e)}")
            
        return session_data
