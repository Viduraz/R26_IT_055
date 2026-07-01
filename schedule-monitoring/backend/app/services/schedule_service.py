
from datetime import datetime, timedelta
import numpy as np
import uuid

"""
schedule-monitoring/backend/app/services/schedule_service.py
Full CRUD for patient schedule items.
"""
import uuid
from datetime import datetime

from shared.backend.config.database import get_db

def _schedules():
    return get_db()["schedules"]

def _activity_logs():
    return get_db()["activity_logs"]

def _notifications():
    return get_db()["notifications"]

def _deviations():
    return get_db()["deviations"]


# Timing Configuration for Presentation & Testing (Easily adjustable)
TIMING_CONFIG = {
    "DURATION_MINUTES": 3.0,
    "LATE_THRESHOLD_MINUTES": 1.5,
    "START_OFFSET_MINUTES": 2.0
}


class ScheduleService:

    """
    Schedule Service with Adaptive Thresholds (Phase 1 ML)
    """

    # ====================== ML-BASED ADAPTIVE MONITORING ======================

    def get_adaptive_grace_period(self, user_id: str, activity_name: str) -> float:
        """Learns personalized grace period from past behavior using ML/statistics"""
        # Retrieve last 50 logs of this activity
        logs = list(_activity_logs().find({
            "user_id": user_id,
            "activity_name": {"$regex": f"^{activity_name}$", "$options": "i"}
        }).sort("detected_at", -1).limit(50))

        # Fallback to the default late threshold if there is not enough historical data
        fallback_threshold = TIMING_CONFIG["LATE_THRESHOLD_MINUTES"]
        if len(logs) < 8:
            return fallback_threshold

        delays = []
        for log in logs:
            expected_start_str = log.get("expected_start")
            detected_at_dt = log.get("detected_at")
            if not expected_start_str or not detected_at_dt:
                continue

            if isinstance(detected_at_dt, str):
                try:
                    detected_at_dt = datetime.fromisoformat(detected_at_dt)
                except ValueError:
                    continue

            try:
                # Combine detected_at date with the expected start time
                expected_time_obj = datetime.strptime(expected_start_str, "%H:%M").time()
                expected_dt = datetime.combine(detected_at_dt.date(), expected_time_obj)
                
                # Difference in minutes
                delay_min = (detected_at_dt.replace(tzinfo=None) - expected_dt.replace(tzinfo=None)).total_seconds() / 60.0
                
                # Filter out extreme delay outliers dynamically based on current duration scale
                duration = TIMING_CONFIG["DURATION_MINUTES"]
                if -2.0 * duration < delay_min < 5.0 * duration:
                    delays.append(delay_min)
            except Exception:
                continue

        if len(delays) < 6:
            return fallback_threshold

        # Statistical grace period calculation: Mean + 1.8 * Standard Deviation
        delays_arr = np.array(delays)
        mean_delay = float(np.mean(delays_arr))
        std_delay = float(np.std(delays_arr))

        grace = mean_delay + (1.8 * std_delay)
        
        # Keep learned grace period bounded to a safe/reasonable range relative to current scale
        min_grace = 0.6 * TIMING_CONFIG["DURATION_MINUTES"]
        max_grace = 1.5 * TIMING_CONFIG["DURATION_MINUTES"]
        grace = max(min_grace, min(max_grace, grace))
        return round(grace, 1)

    def check_activity_status(self, user_id: str, activity_name: str, expected_start: datetime, detected_at: datetime) -> dict:
        """Determines activity status using statistical adaptive thresholds"""
        # Get adaptive grace period from ML (statistical learning)
        grace_minutes = self.get_adaptive_grace_period(user_id, activity_name)
        duration_minutes = TIMING_CONFIG["DURATION_MINUTES"]
        
        detected_naive = detected_at.replace(tzinfo=None)
        expected_naive = expected_start.replace(tzinfo=None)
        
        # Late deadline: expected_start + grace_minutes
        deadline = expected_naive + timedelta(minutes=grace_minutes)
        # Missed boundary: expected_start + duration_minutes
        missed_boundary = expected_naive + timedelta(minutes=duration_minutes)
        
        # Calculate time difference in minutes
        diff_seconds = (detected_naive - expected_naive).total_seconds()
        delay_minutes = round(diff_seconds / 60, 1)

        if detected_naive < expected_naive:
            status = "Early"
            confidence = 0.90
        elif detected_naive <= deadline:
            status = "Done"  # Renders as "Completed" or "Done" in frontend
            confidence = 0.92
        elif detected_naive <= missed_boundary:
            status = "Late"  # Completed but Late
            confidence = 0.65
        else:
            status = "Missed"
            confidence = 0.52

        return {
            "status": status,
            "grace_minutes": grace_minutes,
            "delay_minutes": delay_minutes,
            "confidence": confidence,
            "deadline": deadline.isoformat(),
            "missed_boundary": missed_boundary.isoformat()
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
            user_id=schedule["user_id"],
            activity_name=activity_name,
            expected_start=expected_start,
            detected_at=detected_at
        )

        log_entry = {


    # ── CRUD ───────────────────────────────────────────────────────────

    async def get_all_schedules(self) -> list:
        docs = list(_schedules().find({}, {"_id": 0}))
        return docs

    async def get_schedules_by_patient(self, patient_id: str) -> list:
        docs = list(_schedules().find({"patient_id": patient_id}, {"_id": 0}))
        return docs

    async def create_schedule(self, data: dict) -> dict:
        data["schedule_id"] = str(uuid.uuid4())
        data["created_at"] = datetime.utcnow()
        data["today_status"] = "pending"
        _schedules().insert_one(data)
        return {"success": True, "schedule_id": data["schedule_id"]}

    async def update_schedule(self, schedule_id: str, data: dict) -> dict:
        # Remove None values so we don't accidentally overwrite fields
        update_data = {k: v for k, v in data.items() if v is not None}
        update_data["updated_at"] = datetime.utcnow()
        res = _schedules().update_one(
            {"schedule_id": schedule_id},
            {"$set": update_data},
        )
        return {"success": res.matched_count > 0}

    async def delete_schedule(self, schedule_id: str) -> dict:
        res = _schedules().delete_one({"schedule_id": schedule_id})
        return {"success": res.deleted_count > 0}

    # ── Legacy helpers (kept for compatibility) ────────────────────────

    async def get_schedule(self) -> list:
        return await self.get_all_schedules()

    async def get_reports(self) -> list:
        return list(
            _reports().find({}, {"_id": 0}).sort("generated_at", -1).limit(30)
        )

    async def get_deviations(self) -> list:
        return list(
            _deviations().find({}, {"_id": 0}).sort("detected_at", -1).limit(50)
        )

    async def log_deviation(self, schedule_id: str, observed: str, expected: str):
        _deviations().insert_one({

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

        if status_info["status"] in ["Late", "Missed"]:
            self.create_notification(
                schedule["user_id"],
                activity_name,
                status_info["status"],
                f"{activity_name} was detected {status_info['status'].lower()} "
                f"(Delay: {status_info['delay_minutes']} min. Grace limit: {status_info['grace_minutes']} min)."
            )

        log_entry["_id"] = str(result.inserted_id)
        return log_entry

    # ====================== BACKGROUND TASKS ======================

    def check_missed_activities(self):
        """Background task to check for missed/not done activities."""
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
                    
                    log = _activity_logs().find_one({
                        "schedule_id": schedule_id,
                        "activity_name": activity_name,
                        "created_at": {"$gte": start_of_day, "$lte": end_of_day}
                    })
                    
                    if not log:
                        # Mark as "Not Done" because it was never detected all day
                        log_entry = {
                            "schedule_id": schedule_id,
                            "user_id": user_id,
                            "activity_name": activity_name,
                            "expected_start": activity.get("start_time") if isinstance(activity, dict) else getattr(activity, "start_time", None),
                            "expected_end": activity.get("end_time") if isinstance(activity, dict) else getattr(activity, "end_time", None),
                            "detected_at": None,
                            "status": "Not Done",
                            "adaptive_grace_minutes": TIMING_CONFIG["LATE_THRESHOLD_MINUTES"],
                            "delay_minutes": None,
                            "detection_confidence": 1.0,
                            "signals": {},
                            "created_at": datetime.utcnow()
                        }
                        _activity_logs().insert_one(log_entry)
                        
                        self.create_notification(
                            user_id,
                            activity_name,
                            "Not Done",
                            f"{activity_name} was not done throughout the scheduled time."
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
            # Defensively convert any Pydantic model objects → plain dicts
            if "activities" in s and isinstance(s["activities"], list):
                s["activities"] = [
                    a.model_dump() if hasattr(a, "model_dump") else
                    (dict(a) if not isinstance(a, dict) else a)
                    for a in s["activities"]
                ]
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