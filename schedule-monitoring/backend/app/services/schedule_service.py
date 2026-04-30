from datetime import datetime, timedelta
import numpy as np
import uuid
from shared.backend.config.database import get_db

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
    Schedule Service with Adaptive Thresholds (Phase 1 ML)
    """

    # ====================== 20-MINUTE RULE LOGIC ======================

    def check_activity_status(self, expected_start: datetime, detected_at: datetime) -> dict:
        grace_minutes = 20
        deadline = expected_start + timedelta(minutes=grace_minutes)
        
        # Calculate time difference in minutes
        diff_seconds = (detected_at - expected_start).total_seconds()
        delay_minutes = round(diff_seconds / 60, 1)

        if detected_at < expected_start:
            status = "Early"
            confidence = 1.0
        elif detected_at <= deadline:
            status = "Done"
            confidence = 1.0
        else:
            status = "Late"
            confidence = 1.0

        return {
            "status": status,
            "grace_minutes": grace_minutes,
            "delay_minutes": delay_minutes,
            "confidence": confidence,
            "deadline": deadline.isoformat()
        }

    # ====================== MAIN LOGGING FUNCTION ======================

    def log_activity_detection(self, schedule_id: str, activity_name: str,
                               detected_at: datetime, confidence: float, signals: dict):
        """Main function called from frontend"""
        schedule = _schedules().find_one({"schedule_id": schedule_id})
        if not schedule:
            return {"error": "Schedule not found"}

        target_activity = None
        activities = schedule.get("activities", []) if isinstance(schedule, dict) else getattr(schedule, "activities", [])
        
        for act in activities:
            act_name = act.get("activity_name", "") if isinstance(act, dict) else getattr(act, "activity_name", "")
            if act_name.lower() == activity_name.lower():
                target_activity = act
                break

        if not target_activity:
            return {"error": f"Activity '{activity_name}' not found in schedule"}

        # Expected time today
        target_start = target_activity.get("start_time") if isinstance(target_activity, dict) else target_activity.start_time
        start_time = datetime.strptime(target_start, "%H:%M").time()
        expected_start = datetime.combine(datetime.now().date(), start_time)

        status_info = self.check_activity_status(
            expected_start=expected_start,
            detected_at=detected_at
        )

        log_entry = {
            "schedule_id": schedule_id,
            "user_id": schedule["user_id"],
            "activity_name": activity_name,
            "expected_start": target_activity.get("start_time") if isinstance(target_activity, dict) else target_activity.start_time,
            "expected_end": target_activity.get("end_time") if isinstance(target_activity, dict) else target_activity.end_time,
            "detected_at": detected_at,
            "status": status_info["status"],
            "adaptive_grace_minutes": status_info["grace_minutes"],
            "delay_minutes": status_info["delay_minutes"],
            "detection_confidence": confidence,
            "signals": signals,
            "created_at": datetime.utcnow()
        }

        result = _activity_logs().insert_one(log_entry)

        if status_info["status"] == "Late":
            self.create_notification(
                schedule["user_id"],
                activity_name,
                status_info["status"],
                f"{activity_name} was detected late "
                f"(Delay: {status_info['delay_minutes']} min. Over 20-minute limit)."
            )

        log_entry["_id"] = str(result.inserted_id)
        return log_entry

    # ====================== BACKGROUND TASKS ======================

    def check_missed_activities(self):
        """Background task to check for missed activities."""
        schedules = list(_schedules().find({}))
        local_now = datetime.now()
        
        for schedule in schedules:
            user_id = schedule.get("user_id")
            schedule_id = schedule.get("schedule_id")
            activities = schedule.get("activities", []) if isinstance(schedule, dict) else getattr(schedule, "activities", [])
            for activity in activities:
                activity_name = activity.get("activity_name") if isinstance(activity, dict) else getattr(activity, "activity_name", None)
                end_time_str = activity.get("end_time") if isinstance(activity, dict) else getattr(activity, "end_time", None)
                if not end_time_str:
                    continue
                
                try:
                    end_time_obj = datetime.strptime(end_time_str, "%H:%M").time()
                    expected_end = datetime.combine(local_now.date(), end_time_obj)
                except ValueError:
                    continue
                
                # Check if current time is past the end_time
                if local_now > expected_end:
                    # Check if there is any log for this activity today
                    start_of_day = datetime.combine(local_now.date(), datetime.min.time())
                    end_of_day = datetime.combine(local_now.date(), datetime.max.time())
                    
                    # We look for a log that matches activity_name exactly and is for today
                    log = _activity_logs().find_one({
                        "schedule_id": schedule_id,
                        "activity_name": activity_name,
                        "created_at": {"$gte": start_of_day, "$lte": end_of_day}
                    })
                    
                    if not log:
                        # Mark as Missed
                        log_entry = {
                            "schedule_id": schedule_id,
                            "user_id": user_id,
                            "activity_name": activity_name,
                            "expected_start": activity.get("start_time") if isinstance(activity, dict) else getattr(activity, "start_time", None),
                            "expected_end": activity.get("end_time") if isinstance(activity, dict) else getattr(activity, "end_time", None),
                            "detected_at": None,
                            "status": "Missed",
                            "adaptive_grace_minutes": 20,
                            "delay_minutes": None,
                            "detection_confidence": 1.0,
                            "signals": {},
                            "created_at": datetime.utcnow()
                        }
                        _activity_logs().insert_one(log_entry)
                        
                        self.create_notification(
                            user_id,
                            activity_name,
                            "Missed",
                            f"{activity_name} was entirely missed within its scheduled time."
                        )

    # ====================== YOUR OTHER EXISTING METHODS ======================
    # Add all your other methods here (create_schedule, get_schedule, etc.)

    def create_schedule(self, user_id: str, activities: list, description: str = None):
        """Create a new schedule for a user"""
        schedule_id = str(uuid.uuid4())
        schedule = {
            "schedule_id": schedule_id,
            "user_id": user_id,
            "activities": activities,
            "description": description or "",
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        }
        result = _schedules().insert_one(schedule)
        schedule["_id"] = str(result.inserted_id)
        return schedule

    def delete_schedule(self, user_id: str, schedule_id: str):
        """Delete a schedule and all associated logs/notifications"""
        # Delete the schedule
        result = _schedules().delete_one({"schedule_id": schedule_id, "user_id": user_id})
        if result.deleted_count > 0:
            # Delete associated logs
            _activity_logs().delete_many({"schedule_id": schedule_id})
            return {"message": "Schedule deleted successfully", "deleted": True}
        return {"error": "Schedule not found or you don't have permission to delete it", "deleted": False}

    def get_schedule(self, user_id: str = None):
        """Get all schedules for a user"""
        if user_id:
            schedules = list(_schedules().find({"user_id": user_id}))
        else:
            schedules = list(_schedules().find({}))
        
        for s in schedules:
            s["_id"] = str(s["_id"])
        return schedules

    def get_activity_logs(self, user_id: str = None, limit: int = 100):
        """Get activity logs"""
        query = {"user_id": user_id} if user_id else {}
        logs = list(_activity_logs().find(query).sort("created_at", -1).limit(limit))
        for log in logs:
            log["_id"] = str(log["_id"])
        return logs

    def create_notification(self, user_id: str, activity_name: str, status: str, message: str):
        """Create a notification"""
        notification = {
            "notification_id": str(uuid.uuid4()),
            "user_id": user_id,
            "activity_name": activity_name,
            "status": status,
            "message": message,
            "read": False,
            "created_at": datetime.utcnow()
        }
        result = _notifications().insert_one(notification)
        notification["_id"] = str(result.inserted_id)
        return notification

    def get_notifications(self, user_id: str = None, unread_only: bool = False):
        """Get notifications"""
        query = {"user_id": user_id} if user_id else {}
        if unread_only:
            query["read"] = False
        notifs = list(_notifications().find(query).sort("created_at", -1).limit(50))
        for n in notifs:
            n["_id"] = str(n["_id"])
        return notifs

    def mark_notification_read(self, notification_id: str):
        """Mark notification as read"""
        result = _notifications().update_one(
            {"notification_id": notification_id},
            {"$set": {"read": True}}
        )
        return {"matched": result.matched_count, "modified": result.modified_count}

    def get_reports(self, user_id: str = None):
        """Get activity reports"""
        logs = self.get_activity_logs(user_id)
        stats = {
            "On Time": 0,
            "Slightly Late": 0,
            "Late": 0,
            "total": len(logs)
        }
        for log in logs:
            status = log.get("status", "Unknown")
            if status in stats:
                stats[status] += 1
        return {"stats": stats, "logs": logs}

    def get_deviations(self, user_id: str = None):
        """Get deviations from schedule"""
        query = {"user_id": user_id} if user_id else {}
        deviations = list(_deviations().find(query).sort("detected_at", -1).limit(50))
        for d in deviations:
            d["_id"] = str(d["_id"])
        return deviations