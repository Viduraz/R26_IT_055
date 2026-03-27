"""
gateway-dashboard/backend/app/controllers/dashboard_controller.py
Handles aggregated data queries for the dashboards.
"""
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from shared.backend.auth.jwt_handler import decode_access_token
from shared.backend.config.database import get_db

_bearer = HTTPBearer()


async def get_admin_summary(credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    token = decode_access_token(credentials.credentials)
    if token.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    db = get_db()
    users_coll = db["users"]
    
    total_users = users_coll.count_documents({})
    caregiver_count = users_coll.count_documents({"role": "caregiver"})
    family_count = users_coll.count_documents({"role": "family_member"})
    verified_caregivers = users_coll.count_documents({"role": "caregiver", "face_verification_status": "enrolled"})
    
    # Fake recent alerts (would be connected to anomaly collection)
    recent_alerts = [
        {"id": "A1", "type": "Fall Detected", "time": "2 mins ago", "status": "critical"},
        {"id": "A2", "type": "Unknown Person", "time": "15 mins ago", "status": "warning"}
    ]
    
    return {
        "stats": {
            "total_users": total_users,
            "caregivers": caregiver_count,
            "families": family_count,
            "verified_caregivers": verified_caregivers
        },
        "recent_alerts": recent_alerts
    }

async def get_caregiver_profile(credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    token = decode_access_token(credentials.credentials)
    if token.get("role") != "caregiver":
        raise HTTPException(status_code=403, detail="Caregiver access required")
    
    db = get_db()
    user = db["users"].find_one({"_id": token.get("sub")}) or {}
    
    return {
        "profile": {
            "name": token.get("email"), # fallback
            "face_status": user.get("face_verification_status", "pending"),
            "shift": "Morning Shift (08:00 - 16:00)",
            "assigned_elder": "Mr. Robert Smith"
        },
        "recent_verifications": [
            {"date": "Today 08:01 AM", "status": "Success", "confidence": "98.5%"},
            {"date": "Yesterday 07:58 AM", "status": "Success", "confidence": "97.2%"}
        ]
    }

async def get_family_alerts(credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    token = decode_access_token(credentials.credentials)
    if token.get("role") != "family_member":
        raise HTTPException(status_code=403, detail="Family member access required")
    
    return {
        "elder_status": "Safe & Monitored",
        "last_seen": "Living Room, 5 mins ago",
        "alerts": [
            {"message": "Scheduled Medication Taken", "time": "09:00 AM", "type": "info"},
            {"message": "Caregiver Jane verified on premises", "time": "08:15 AM", "type": "success"}
        ]
    }
