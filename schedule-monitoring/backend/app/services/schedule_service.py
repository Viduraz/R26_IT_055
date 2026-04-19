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

    # ====================== ADAPTIVE ML LOGIC ======================

    def get_adaptive_grace_period(self, user_id: str, activity_name: str) -> int:
        """Learn personalized grace period from past behavior"""
        logs = list(_activity_logs().find({
            "user_id": user_id,
            "activity_name": {"$regex": f"^{activity_name}$", "$options": "i"}
        }).sort("detected_at", -1).limit(50))

        if len(logs) < 8:
            return 20

        delays = []
        for log in logs:
            if not log.get("expected_start") or not log.get("detected_at"):
                continue

            detected = log["detected_at"]
            if isinstance(detected, str):
                detected = datetime.fromisoformat(detected.replace('Z', '+00:00'))

            if isinstance(log["expected_start"], str):
                expected_time = datetime.strptime(log["expected_start"], "%H:%M").time()
                expected = datetime.combine(detected.date(), expected_time)
            else:
                expected = log["expected_start"]

            delay_min = (detected - expected).total_seconds() / 60

            if -20 < delay_min < 120:
                delays.append(delay_min)

        if len(delays) < 6:
            return 20

        delays_arr = np.array(delays)
        mean_delay = float(np.mean(delays_arr))
        std_delay = float(np.std(delays_arr))

        grace = mean_delay + (1.8 * std_delay)
        grace = max(12, min(45, round(grace)))
        return grace

    def check_activity_status(self, user_id: str, activity_name: str,
                              expected_start: datetime, detected_at: datetime) -> dict:
        grace_minutes = self.get_adaptive_grace_period(user_id, activity_name)
        deadline = expected_start + timedelta(minutes=grace_minutes)
        delay_minutes = round((detected_at - expected_start).total_seconds() / 60, 1)

        if detected_at <= deadline:
            status = "On Time"
            confidence = 0.92
        elif delay_minutes <= grace_minutes + 18:
            status = "Slightly Late"
            confidence = 0.65
        else:
            status = "Late"
            confidence = 0.52

        return {
            "status": status,
            "adaptive_grace_minutes": grace_minutes,
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
        for act in schedule.get("activities", []):
            if act.get("activity_name", "").lower() == activity_name.lower():
                target_activity = act
                break

        if not target_activity:
            return {"error": f"Activity '{activity_name}' not found in schedule"}

        # Expected time today
        start_time = datetime.strptime(target_activity["start_time"], "%H:%M").time()
        expected_start = datetime.combine(datetime.now().date(), start_time)

        status_info = self.check_activity_status(
            user_id=schedule["user_id"],
            activity_name=activity_name,
            expected_start=expected_start,
            detected_at=detected_at
        )

        log_entry = {
            "schedule_id": schedule_id,
            "user_id": schedule["user_id"],
            "activity_name": activity_name,
            "expected_start": target_activity["start_time"],
            "expected_end": target_activity["end_time"],
            "detected_at": detected_at,
            "status": status_info["status"],
            "adaptive_grace_minutes": status_info["adaptive_grace_minutes"],
            "delay_minutes": status_info["delay_minutes"],
            "detection_confidence": confidence,
            "signals": signals,
            "created_at": datetime.utcnow()
        }

        result = _activity_logs().insert_one(log_entry)

        if status_info["status"] in ["Late", "Slightly Late"]:
            self.create_notification(
                schedule["user_id"],
                activity_name,
                status_info["status"],
                f"{activity_name} detected {status_info['status'].lower()} "
                f"(Delay: {status_info['delay_minutes']} min | Grace: {status_info['adaptive_grace_minutes']} min)"
            )

        log_entry["_id"] = str(result.inserted_id)
        return log_entry

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