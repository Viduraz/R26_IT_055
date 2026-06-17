from datetime import datetime, timedelta
import numpy as np
from typing import Dict
from app.models import ActivityLog, Schedule   # ← Keep your original import

class ScheduleService:
    
    # ==================== NEW ADAPTIVE METHODS ====================
    
    def get_adaptive_grace_period(self, user_id: str, activity_name: str) -> int:
        """Learns personalized grace period from past behavior"""
        logs = list(ActivityLog.objects(
            user_id=user_id,
            activity_name__iexact=activity_name
        ).order_by('-detected_at')[:50])

        if len(logs) < 8:
            return 20  # Fallback to old rule

        delays = []
        for log in logs:
            if not log.expected_start or not log.detected_at:
                continue
            expected = datetime.combine(log.detected_at.date(), log.expected_start.time())
            delay_min = (log.detected_at - expected).total_seconds() / 60
            
            if -20 < delay_min < 120:
                delays.append(delay_min)

        if len(delays) < 6:
            return 20

        delays = np.array(delays)
        avg_delay = float(np.mean(delays))
        std_delay = float(np.std(delays))

        grace = avg_delay + (1.8 * std_delay)
        grace = max(12, min(45, round(grace)))
        return grace

    def check_activity_status(self, user_id: str, activity_name: str,
                            expected_start: datetime, detected_at: datetime) -> Dict:
        """Smart status using adaptive thresholds"""
        grace_minutes = self.get_adaptive_grace_period(user_id, activity_name)
        deadline = expected_start + timedelta(minutes=grace_minutes)

        delay_minutes = round((detected_at - expected_start).total_seconds() / 60, 1)

        if detected_at <= deadline:
            status = "On Time"
            conf = 0.92
        elif delay_minutes <= grace_minutes + 18:
            status = "Slightly Late"
            conf = 0.65
        else:
            status = "Late"
            conf = 0.52

        return {
            "status": status,
            "adaptive_grace_minutes": grace_minutes,
            "delay_minutes": delay_minutes,
            "confidence": conf,
            "deadline": deadline.isoformat()
        }

    def log_activity_detection(self, schedule_id: str, activity_name: str,
                             detected_at: datetime, confidence: float, signals: dict):
        """Enhanced logging with adaptive logic"""
        schedule = Schedule.objects(id=schedule_id).first()
        if not schedule:
            return {"error": "Schedule not found"}

        # Find expected time
        expected_start = None
        for act in schedule.activities:
            if act.activity_name.lower() == activity_name.lower():
                today = datetime.now().date()
                expected_start = datetime.combine(today, 
                    datetime.strptime(act.start_time, "%H:%M").time())
                break

        if not expected_start:
            status_info = {"status": "Unexpected", "adaptive_grace_minutes": 0}
        else:
            status_info = self.check_activity_status(
                user_id=schedule.user_id,
                activity_name=activity_name,
                expected_start=expected_start,
                detected_at=detected_at
            )

        # Save log
        log = ActivityLog(
            schedule_id=schedule_id,
            user_id=schedule.user_id,
            activity_name=activity_name,
            expected_start=expected_start,
            detected_at=detected_at,
            status=status_info["status"],
            confidence=confidence,
            signals=signals,
            adaptive_grace_minutes=status_info.get("adaptive_grace_minutes")
        )
        log.save()

        if status_info["status"] in ["Late", "Slightly Late"]:
            self._create_late_notification(schedule.user_id, activity_name, status_info)

        return {
            "success": True,
            "activity_name": activity_name,
            **status_info
        }

    def _create_late_notification(self, user_id, activity_name, status_info):
        # TODO: Add your notification logic here later
        pass

    # ==================== YOUR OLD METHODS (KEEP ALL OF THESE) ====================
    
    # Paste all your existing methods here ↓↓↓
    # For example:
    def get_schedule(self, user_id):
        # your original code...
        pass

    def create_schedule(self, user_id, activities, description):
        # your original code...
        pass

    def get_activity_logs(self, user_id):
        # your original code...
        pass

    def get_reports(self):
        # your original code...
        pass

    # ... and so on for get_deviations, get_notifications, etc.