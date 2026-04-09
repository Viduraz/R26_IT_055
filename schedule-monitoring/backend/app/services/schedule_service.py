"""
schedule-monitoring/backend/app/services/schedule_service.py
Handles routine schedule CRUD, activity logging, 20-minute rule validation, and deviation detection.
"""
from datetime import datetime, timedelta
from shared.backend.config.database import get_db
from bson.objectid import ObjectId
import uuid


def _schedules():
    return get_db()["schedules"]


def _activity_logs():
    return get_db()["activity_logs"]


def _notifications():
    return get_db()["notifications"]


def _deviations():
    return get_db()["deviations"]


class ScheduleService:
    """
    Manages schedule creation, activity logging, and 20-minute rule validation.
    """

    # ==================== SCHEDULE CRUD ====================

    def create_schedule(self, user_id: str, activities: list, description: str = None) -> dict:
        """
        Create a new schedule with activities and time ranges.
        activities: [{"activity_name": "Wake up", "start_time": "06:00", "end_time": "06:30"}, ...]
        """
        schedule_id = str(uuid.uuid4())
        schedule = {
            "schedule_id": schedule_id,
            "user_id": user_id,
            "activities": activities,
            "description": description,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
            "active": True
        }
        _schedules().insert_one(schedule)
        return {**schedule, "_id": None}

    def get_schedule(self, user_id: str = None) -> list:
        """Get all active schedules for a user or all schedules if user_id is None."""
        query = {"active": True}
        if user_id:
            query["user_id"] = user_id
        schedules = list(_schedules().find(query, {"_id": 0}))
        return schedules

    def update_schedule(self, schedule_id: str, activities: list, description: str = None) -> dict:
        """Update an existing schedule."""
        updated_schedule = _schedules().find_one_and_update(
            {"schedule_id": schedule_id},
            {"$set": {
                "activities": activities,
                "description": description,
                "updated_at": datetime.utcnow()
            }},
            return_document=True
        )
        if updated_schedule:
            updated_schedule.pop("_id", None)
        return updated_schedule

    def delete_schedule(self, schedule_id: str):
        """Soft delete a schedule."""
        _schedules().update_one(
            {"schedule_id": schedule_id},
            {"$set": {"active": False}}
        )

    # ==================== ACTIVITY LOGGING ====================

    def log_activity_detection(self, schedule_id: str, activity_name: str, 
                                    detected_at: datetime, confidence: float, signals: dict) -> dict:
        """
        Log detected activity and validate against 20-minute rule.
        Returns: activity log entry with status (Done/Late/Missed)
        """
        schedule = _schedules().find_one({"schedule_id": schedule_id})
        if not schedule:
            return {"error": "Schedule not found"}

        # Find the matching activity in schedule
        target_activity = None
        for act in schedule["activities"]:
            if act["activity_name"].lower() == activity_name.lower():
                target_activity = act
                break

        if not target_activity:
            return {"error": f"Activity '{activity_name}' not in schedule"}

        # Parse times
        start_time = datetime.strptime(target_activity["start_time"], "%H:%M").time()
        end_time = datetime.strptime(target_activity["end_time"], "%H:%M").time()

        # Determine detection time relative to schedule
        detected_time = detected_at.time()
        deadline_time = (datetime.combine(datetime.today(), start_time) + timedelta(minutes=20)).time()

        # Assign status based on 20-minute rule
        if detected_time < deadline_time:
            status = "Done"
        else:
            status = "Late"

        # Create activity log entry
        log_entry = {
            "schedule_id": schedule_id,
            "activity_name": activity_name,
            "expected_start": target_activity["start_time"],
            "expected_end": target_activity["end_time"],
            "detected_at": detected_at,
            "status": status,
            "detection_confidence": confidence,
            "signals": signals,
            "created_at": datetime.utcnow()
        }
        result = _activity_logs().insert_one(log_entry)
        log_entry["_id"] = str(result.inserted_id)

        # Send notification if Late
        if status == "Late":
            self.create_notification(
                schedule["user_id"],
                activity_name,
                "Late",
                f"{activity_name} detected late (expected by {deadline_time.strftime('%H:%M')})"
            )

        return log_entry

    def log_missed_activity(self, schedule_id: str, activity_name: str, 
                                 expected_end_time: str) -> dict:
        """
        Log a missed activity (not detected during full time range).
        """
        schedule = _schedules().find_one({"schedule_id": schedule_id})
        if not schedule:
            return {"error": "Schedule not found"}

        log_entry = {
            "schedule_id": schedule_id,
            "activity_name": activity_name,
            "expected_end": expected_end_time,
            "detected_at": None,
            "status": "Missed",
            "detection_confidence": 0.0,
            "created_at": datetime.utcnow()
        }
        result = _activity_logs().insert_one(log_entry)
        log_entry["_id"] = str(result.inserted_id)

        # Send notification for missed activity
        self.create_notification(
            schedule["user_id"],
            activity_name,
            "Missed",
            f"{activity_name} was not detected during the scheduled time ({expected_end_time})"
        )

        return log_entry

    def get_activity_logs(self, user_id: str = None, limit: int = 100) -> list:
        """Get activity logs for a user."""
        query = {}
        if user_id:
            # Join with schedules to filter by user
            pipeline = [
                {"$lookup": {
                    "from": "schedules",
                    "localField": "schedule_id",
                    "foreignField": "schedule_id",
                    "as": "schedule"
                }},
                {"$match": {"schedule.user_id": user_id}},
                {"$sort": {"created_at": -1}},
                {"$limit": limit},
                {"$project": {"_id": 0}}
            ]
            return list(_activity_logs().aggregate(pipeline))
        else:
            return list(_activity_logs().find(query, {"_id": 0}).sort("created_at", -1).limit(limit))

    # ==================== NOTIFICATION SYSTEM ====================

    def create_notification(self, user_id: str, activity_name: str, 
                                 status: str, message: str) -> dict:
        """Create a notification (Late or Missed)."""
        notification = {
            "notification_id": str(uuid.uuid4()),
            "user_id": user_id,
            "activity_name": activity_name,
            "status": status,  # "Late" or "Missed"
            "message": message,
            "created_at": datetime.utcnow(),
            "read": False
        }
        _notifications().insert_one(notification)
        return {k: v for k, v in notification.items() if k != "_id"}

    def get_notifications(self, user_id: str, unread_only: bool = False) -> list:
        """Get notifications for a user."""
        query = {"user_id": user_id}
        if unread_only:
            query["read"] = False
        return list(_notifications().find(query, {"_id": 0}).sort("created_at", -1).limit(50))

    def mark_notification_as_read(self, notification_id: str):
        """Mark a notification as read."""
        _notifications().update_one(
            {"notification_id": notification_id},
            {"$set": {"read": True}}
        )

    # ==================== DEVIATION DETECTION ====================

    def log_deviation(self, schedule_id: str, expected_activity: str, 
                           observed_activity: str, severity: str = "medium") -> dict:
        """Log a deviation (activity mismatch)."""
        deviation = {
            "schedule_id": schedule_id,
            "expected_activity": expected_activity,
            "observed_activity": observed_activity,
            "severity": severity,
            "detected_at": datetime.utcnow()
        }
        _deviations().insert_one(deviation)
        return {k: v for k, v in deviation.items() if k != "_id"}

    def get_deviations(self, user_id: str = None, limit: int = 50) -> list:
        """Get all deviations, optionally filtered by user."""
        query = {}
        if user_id:
            # Join with schedules to filter by user
            pipeline = [
                {"$lookup": {
                    "from": "schedules",
                    "localField": "schedule_id",
                    "foreignField": "schedule_id",
                    "as": "schedule"
                }},
                {"$match": {"schedule.user_id": user_id}},
                {"$sort": {"detected_at": -1}},
                {"$limit": limit},
                {"$project": {"_id": 0}}
            ]
            return list(_deviations().aggregate(pipeline))
        else:
            return list(_deviations().find(query, {"_id": 0}).sort("detected_at", -1).limit(limit))

    # ==================== REPORTING ====================

    def get_reports(self) -> list:
        """Generate activity reports from logs."""
        pipeline = [
            {"$group": {
                "_id": "$activity_name",
                "total": {"$sum": 1},
                "done": {"$sum": {"$cond": [{"$eq": ["$status", "Done"]}, 1, 0]}},
                "late": {"$sum": {"$cond": [{"$eq": ["$status", "Late"]}, 1, 0]}},
                "missed": {"$sum": {"$cond": [{"$eq": ["$status", "Missed"]}, 1, 0]}}
            }},
            {"$sort": {"_id": 1}}
        ]
        return list(_activity_logs().aggregate(pipeline))
