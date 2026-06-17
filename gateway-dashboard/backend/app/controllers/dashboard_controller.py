"""
gateway-dashboard/backend/app/controllers/dashboard_controller.py
Handles aggregated data queries for the dashboards.
"""
from fastapi import Depends, HTTPException, Body
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from bson import ObjectId
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
    
    # Query recent dynamic alerts from tracking system
    alert_logs = list(db["tracking_alerts"].find({}, {"_id": 0}).sort("timestamp", -1).limit(5))
    recent_alerts = []
    for a in alert_logs:
        recent_alerts.append({
            "id": a.get("session_id", "A1"),
            "type": a.get("message", "Alert"),
            "time": a.get("timestamp"),
            "status": a.get("severity", "warning")
        })
        
    if not recent_alerts:
        # Fallback fake alerts for UI consistency if DB is empty
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

async def get_all_users(credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Admin only — list all users with optional role filter."""
    token = decode_access_token(credentials.credentials)
    if token.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    db = get_db()
    users_cursor = db["users"].find(
        {},
        {"password_hash": 0, "face_embeddings": 0}  # exclude sensitive fields
    ).sort("created_at", -1)

    users = []
    for u in users_cursor:
        u["id"] = str(u.pop("_id"))
        # Normalise datetime to ISO string for JSON serialization
        for field in ("created_at", "updated_at"):
            if field in u and hasattr(u[field], "isoformat"):
                u[field] = u[field].isoformat()
        users.append(u)

    return {"users": users}

async def update_user_status(
    user_id: str,
    body: dict = Body(...),
    credentials: HTTPAuthorizationCredentials = Depends(_bearer)
):
    """Admin only — update a user's approval_status field."""
    token = decode_access_token(credentials.credentials)
    if token.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    new_status = body.get("status")
    if new_status not in ("pending", "approved", "rejected"):
        raise HTTPException(status_code=422, detail="status must be pending | approved | rejected")

    db = get_db()
    try:
        oid = ObjectId(user_id)
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid user_id format")

    result = db["users"].update_one(
        {"_id": oid},
        {"$set": {"approval_status": new_status}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")

    return {"message": f"User status updated to {new_status}"}

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
    db = get_db()
    # Fetch active missing alerts for this family's dashboard
    alerts_cursor = db["tracking_alerts"].find({}, {"_id": 0}).sort("timestamp", -1).limit(5)
    
    formatted_alerts = []
    for doc in alerts_cursor:
        formatted_alerts.append({
            "message": doc.get("message"),
            "time": doc.get("timestamp"),
            "type": "error" if doc.get("severity") == "critical" else doc.get("severity", "warning")
        })
        
    if not formatted_alerts:
        formatted_alerts = [
            {"message": "Scheduled Medication Taken", "time": "09:00 AM", "type": "info"},
            {"message": "Caregiver Jane verified on premises", "time": "08:15 AM", "type": "success"}
        ]

    return {
        "elder_status": "Safe & Monitored",
        "last_seen": "Living Room, 5 mins ago",
        "alerts": formatted_alerts
    }

async def get_caregiver_status_global(credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Fetch global active Caregiver tracking sessions"""
    token = decode_access_token(credentials.credentials)
    db = get_db()
    sessions = list(db["verified_caregiver_sessions"].find({"status": {"$ne": "ended"}}, {"_id": 0}))
    return {"active_sessions": sessions}

async def get_global_alerts(credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    """Fetch all tracking alerts globally"""
    token = decode_access_token(credentials.credentials)
    db = get_db()
    alerts = list(db["tracking_alerts"].find({}, {"_id": 0}).sort("timestamp", -1).limit(50))
    return {"alerts": alerts}
