"""
schedule-monitoring/backend/app/controllers/schedule_controller.py
"""
from app.services.schedule_service import ScheduleService
from app.schemas.schedule_schema import CreateScheduleSchema, ActivityDetectionSchema
from datetime import datetime

_svc = ScheduleService()


def get_schedule(user: dict):
    """Get current schedule for the user."""
    return _svc.get_schedule(user.get("user_id"))


def create_schedule(user: dict, payload: CreateScheduleSchema):
    """Create a new schedule with activities."""
    return _svc.create_schedule(
        user_id=user.get("user_id", "dev-user"),
        activities=payload.activities,
        description=payload.description
    )


def get_reports(user: dict):
    """Get activity reports."""
    return _svc.get_reports()


def get_deviations(user: dict):
    """Get detected deviations."""
    return _svc.get_deviations(user.get("user_id"))


def get_activity_logs(user: dict):
    """Get activity logs."""
    return _svc.get_activity_logs(user.get("user_id"))


def log_detected_activity(user: dict, schedule_id: str, payload: ActivityDetectionSchema):
    """
    Called by the vision/ML module when an activity is detected.
    Validates against 20-minute rule and logs accordingly.
    """
    return _svc.log_activity_detection(
        schedule_id=schedule_id,
        activity_name=payload.activity_name,
        detected_at=payload.detected_at,
        confidence=payload.confidence,
        signals=payload.signals
    )


def get_notifications(user: dict, unread_only: bool = False):
    """Get notifications for the user."""
    return _svc.get_notifications(user.get("user_id"), unread_only)


def mark_notification_read(user: dict, notification_id: str):
    """Mark notification as read."""
    _svc.mark_notification_as_read(notification_id)
    return {"message": "Notification marked as read"}
