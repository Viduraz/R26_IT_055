# backend/app/controllers/schedule_controller.py
from app.services.schedule_service import ScheduleService
from datetime import datetime

_svc = ScheduleService()


def get_schedule(user: dict):
    """Get current schedule for the user."""
    return _svc.get_schedule(user.get("user_id"))


def create_schedule(user: dict, payload):
    """Create a new schedule."""
    return _svc.create_schedule(
        user_id=user.get("user_id", "dev-user"),
        activities=payload.activities,
        description=payload.description
    )


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
            user_id=user.get("user_id"),
            activity_name=payload["activity_name"],
            expected_start=datetime.now(),           # Will be overridden inside service
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