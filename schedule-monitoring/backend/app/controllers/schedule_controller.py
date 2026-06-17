
# backend/app/controllers/schedule_controller.py

"""
schedule-monitoring/backend/app/controllers/schedule_controller.py
"""
from fastapi import HTTPException

from app.services.schedule_service import ScheduleService
from datetime import datetime

_svc = ScheduleService()


def get_schedule(user: dict):
    """Get current schedule for the user."""
    return _svc.get_schedule(user.get("user_id"))


def create_schedule(user: dict, payload):
    """Create a new schedule."""
    # Convert Pydantic ActivitySchema objects to plain dicts so the
    # mock in-memory DB (and service layer) can use .get() on them.
    activities_as_dicts = [
        a.model_dump() if hasattr(a, "model_dump") else dict(a)
        for a in payload.activities
    ]
    return _svc.create_schedule(
        user_id=user.get("user_id", "dev-user"),
        activities=activities_as_dicts,
        description=payload.description
    )

async def get_all_schedules(user: dict):
    return await _svc.get_all_schedules()


async def get_schedule(user: dict):
    return await _svc.get_all_schedules()


async def get_schedules_by_patient(patient_id: str, user: dict):
    return await _svc.get_schedules_by_patient(patient_id)


async def create_schedule(data: dict, user: dict):
    return await _svc.create_schedule(data)


async def update_schedule(schedule_id: str, data: dict, user: dict):
    result = await _svc.update_schedule(schedule_id, data)
    if not result.get("success"):
        raise HTTPException(status_code=404, detail="Schedule not found")
    return result


async def delete_schedule(schedule_id: str, user: dict):
    result = await _svc.delete_schedule(schedule_id)
    if not result.get("success"):
        raise HTTPException(status_code=404, detail="Schedule not found")
    return result



def delete_schedule(user: dict, schedule_id: str):
    """Delete a schedule."""
    return _svc.delete_schedule(user.get("user_id", "dev-user"), schedule_id)


def log_detected_activity(user: dict, schedule_id: str, payload):
    """Log detected activity - Now uses Adaptive Thresholds automatically"""
    detected_at = payload.detected_at
    if isinstance(detected_at, str):
        detected_at = datetime.fromisoformat(detected_at.replace("Z", "+00:00"))
    
    return _svc.log_activity_detection(
        schedule_id=schedule_id,
        activity_name=payload.activity_name,
        detected_at=detected_at,
        confidence=payload.confidence,
        signals=payload.signals
    )


def validate_activity(user: dict, payload: dict):
    """Real-time validation with adaptive grace period (used by frontend)"""
    try:
        detected_at = datetime.fromisoformat(payload["detected_at"].replace("Z", "+00:00"))
        
        # Note: We pass a dummy expected_start because the service will calculate 
        # the correct one internally based on the schedule. 
        # You can improve this later by sending expected_start from frontend.
        return _svc.check_activity_status(
            expected_start=datetime.now(),
            detected_at=detected_at
        )
    except Exception as e:
        return {"error": f"Validation failed: {str(e)}"}


def get_activity_logs(user: dict):
    """Get activity logs"""
    return _svc.get_activity_logs(user.get("user_id"))


def get_reports(user: dict):
    """Get activity reports"""
    return _svc.get_reports()


def get_notifications(user: dict, unread_only: bool = False):
    """Get notifications"""
    return _svc.get_notifications(user.get("user_id"), unread_only)


def mark_notification_read(user: dict, notification_id: str):
    """Mark notification as read"""
    return _svc.mark_notification_read(notification_id)


def get_deviations(user: dict):
    """Get deviations (if you have this method in service)"""
    return _svc.get_deviations(user.get("user_id"))