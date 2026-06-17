"""
schedule-monitoring/backend/app/controllers/monitoring_controller.py
"""
from app.services.monitoring_service import MonitoringService
from app.services.notification_service import NotificationService

_monitoring = MonitoringService()
_notif = NotificationService()


async def handle_detection_event(event: dict) -> dict:
    return _monitoring.process_detection_event(event)


async def get_today_status(patient_id: str) -> dict:
    return _monitoring.get_today_status(patient_id)


async def get_activity_logs(patient_id: str) -> list:
    return _monitoring.get_activity_logs(patient_id)


async def get_notifications(patient_id: str) -> dict:
    notifs = _notif.get_notifications(patient_id)
    unread = _notif.get_unread_count(patient_id)
    return {"notifications": notifs, "unread_count": unread}


async def mark_notification_read(notification_id: str) -> dict:
    return _notif.mark_read(notification_id)


async def mark_all_notifications_read(patient_id: str) -> dict:
    return _notif.mark_all_read(patient_id)


async def trigger_missed_evaluation(patient_id: str) -> dict:
    return _monitoring.evaluate_missed_tasks(patient_id)
