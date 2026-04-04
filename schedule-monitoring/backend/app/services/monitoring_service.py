"""
schedule-monitoring/backend/app/services/monitoring_service.py

Core business logic:
  - Receives vision detection events
  - Applies the 20-minute validation rule
  - Marks tasks Done / Late / Missed / Caregiver-Missing
  - Persists activity logs
  - Triggers notifications
"""
import uuid
from datetime import datetime
from typing import Optional
from shared.backend.config.database import get_db


# ── DB collections ─────────────────────────────────────────────────────────
def _schedules_col():
    return get_db()["schedules"]


def _logs_col():
    return get_db()["activity_logs"]


# ── Activity → task-type mapping ───────────────────────────────────────────
# Maps what the vision module reports to the task-types we store in schedules.
ACTIVITY_TO_TASK_TYPES: dict[str, list[str]] = {
    "eating":        ["meal", "caregiver_assisted"],
    "meal":          ["meal"],
    "drinking":      ["hydration", "caregiver_assisted"],
    "hydration":     ["hydration"],
    "sleeping":      ["sleep"],
    "lying":         ["sleep", "rest"],
    "wake_up":       ["sleep"],
    "sitting":       ["rest"],
    "rest":          ["rest"],
    "walking":       ["exercise"],
    "exercise":      ["exercise"],
    "hand_to_mouth": ["medication", "meal"],
    "medication":    ["medication", "caregiver_assisted"],
    "feeding":       ["meal", "caregiver_assisted"],
    "bathing":       ["caregiver_assisted"],
}


class MonitoringService:

    # ── Helpers ────────────────────────────────────────────────────────────

    @staticmethod
    def _time_to_minutes(time_str: str) -> int:
        """'HH:MM' → minutes since midnight."""
        h, m = map(int, time_str.split(":"))
        return h * 60 + m

    def _active_schedules(self, patient_id: str) -> list:
        """Return active schedule items for today's weekday."""
        today_abbr = datetime.utcnow().strftime("%a")   # "Mon", "Tue", …
        return list(_schedules_col().find({
            "patient_id": patient_id,
            "active": True,
            "$or": [
                {"repeat_days": []},
                {"repeat_days": {"$in": [today_abbr]}},
            ],
        }))

    # ── Core: process a detection event ───────────────────────────────────

    def process_detection_event(self, event: dict) -> dict:
        """
        Compare a vision detection against scheduled tasks.

        Status rules
        ────────────
        DONE            – detected within first 20 min of start_time
        LATE            – detected after 20-min threshold, still before end_time
        CAREGIVER_MISSING – caregiver_required=True but caregiver_present=False
        """
        patient_id  = event.get("patient_id", "patient_001")
        activity    = event.get("detected_activity", "").lower()
        caregiver_p = event.get("caregiver_present", False)
        caregiver_id = event.get("caregiver_id")
        confidence  = event.get("confidence", 0.0)

        # Parse timestamp
        ts = event.get("timestamp")
        if ts is None:
            ts = datetime.utcnow()
        elif isinstance(ts, str):
            try:
                ts = datetime.fromisoformat(ts.replace("Z", ""))
            except Exception:
                ts = datetime.utcnow()

        matched_task_types = ACTIVITY_TO_TASK_TYPES.get(activity, [activity])
        schedules    = self._active_schedules(patient_id)
        today_str    = ts.strftime("%Y-%m-%d")
        now_minutes  = ts.hour * 60 + ts.minute

        results = []

        for sched in schedules:
            task_type = sched.get("task_type", "")
            if task_type not in matched_task_types:
                continue

            start_min = self._time_to_minutes(sched["start_time"])
            end_min   = self._time_to_minutes(sched["end_time"])

            # Only evaluate within or just after the window (30-min grace)
            if now_minutes < start_min or now_minutes > end_min + 30:
                continue

            schedule_id = str(sched.get("schedule_id", sched.get("_id", "")))

            # Skip if already marked done/late for today
            existing = _logs_col().find_one({
                "schedule_id": schedule_id,
                "date": today_str,
                "status": {"$in": ["done", "late", "caregiver_missing"]},
            })
            if existing:
                continue

            # ── 20-minute rule ────────────────────────────────────────────
            threshold = start_min + 20
            if now_minutes <= threshold:
                status = "done"
            else:
                status = "late"

            # Override: caregiver required but absent
            if sched.get("caregiver_required", False) and not caregiver_p:
                status = "caregiver_missing"

            # Persist activity log
            log_entry = {
                "log_id":            str(uuid.uuid4()),
                "patient_id":        patient_id,
                "schedule_id":       schedule_id,
                "task_name":         sched.get("task_name", ""),
                "task_type":         task_type,
                "date":              today_str,
                "scheduled_range":   f"{sched['start_time']} – {sched['end_time']}",
                "detected_at":       ts,
                "detected_activity": activity,
                "caregiver_present": caregiver_p,
                "caregiver_required": sched.get("caregiver_required", False),
                "caregiver_id":      caregiver_id,
                "confidence":        confidence,
                "status":            status,
                "created_at":        datetime.utcnow(),
            }
            _logs_col().insert_one(log_entry)

            # Update schedule's today_status cache
            _schedules_col().update_one(
                {"schedule_id": schedule_id},
                {"$set": {"today_status": status, "detected_at": ts}},
            )

            # Trigger notifications for non-done events
            if status in ("late", "missed", "caregiver_missing"):
                from app.services.notification_service import NotificationService
                ns = NotificationService()
                msgs = {
                    "late": f"⚠️ {sched.get('task_name')} was completed late at {ts.strftime('%H:%M')}.",
                    "caregiver_missing": (
                        f"🚨 {sched.get('task_name')} completed but caregiver was absent!"
                    ),
                }
                ns.create_notification(
                    patient_id, sched.get("task_name", ""), status,
                    msgs.get(status, f"{sched.get('task_name')} — {status}"),
                )

            results.append({
                "schedule_id": schedule_id,
                "task_name":   sched.get("task_name"),
                "status":      status,
            })

        return {"matched": len(results), "results": results}

    # ── Background sweep: mark MISSED ──────────────────────────────────────

    def evaluate_missed_tasks(self, patient_id: str = "patient_001") -> dict:
        """
        Called by the background sweep thread every 60 s.
        Marks tasks whose time window has fully passed with no detection as MISSED.
        """
        schedules    = self._active_schedules(patient_id)
        now          = datetime.utcnow()
        now_minutes  = now.hour * 60 + now.minute
        today_str    = now.strftime("%Y-%m-%d")
        missed_count = 0

        from app.services.notification_service import NotificationService
        ns = NotificationService()

        for sched in schedules:
            end_min = self._time_to_minutes(sched["end_time"])
            if now_minutes <= end_min:
                continue   # window still open

            schedule_id = str(sched.get("schedule_id", sched.get("_id", "")))

            # Already has any log entry today → skip
            if _logs_col().find_one({"schedule_id": schedule_id, "date": today_str}):
                continue

            # Insert missed log
            _logs_col().insert_one({
                "log_id":            str(uuid.uuid4()),
                "patient_id":        patient_id,
                "schedule_id":       schedule_id,
                "task_name":         sched.get("task_name", ""),
                "task_type":         sched.get("task_type", ""),
                "date":              today_str,
                "scheduled_range":   f"{sched['start_time']} – {sched['end_time']}",
                "detected_at":       None,
                "caregiver_present": False,
                "caregiver_required": sched.get("caregiver_required", False),
                "status":            "missed",
                "created_at":        now,
            })

            _schedules_col().update_one(
                {"schedule_id": schedule_id},
                {"$set": {"today_status": "missed"}},
            )

            ns.create_notification(
                patient_id,
                sched.get("task_name", ""),
                "missed",
                f"❌ {sched.get('task_name')} was MISSED "
                f"(scheduled {sched['start_time']} – {sched['end_time']})",
            )
            missed_count += 1

        return {"missed_marked": missed_count}

    # ── Queries ────────────────────────────────────────────────────────────

    def get_today_status(self, patient_id: str) -> dict:
        """Return today's full schedule with live statuses and summary."""
        schedules   = self._active_schedules(patient_id)
        today_str   = datetime.utcnow().strftime("%Y-%m-%d")
        now_minutes = datetime.utcnow().hour * 60 + datetime.utcnow().minute

        tasks = []
        for sched in schedules:
            schedule_id   = str(sched.get("schedule_id", sched.get("_id", "")))
            log           = _logs_col().find_one({"schedule_id": schedule_id, "date": today_str})

            status          = "pending"
            detected_at     = None
            caregiver_pres  = False

            if log:
                status         = log.get("status", "pending")
                det            = log.get("detected_at")
                detected_at    = det.strftime("%H:%M") if isinstance(det, datetime) else (str(det) if det else None)
                caregiver_pres = log.get("caregiver_present", False)
            else:
                end_min = self._time_to_minutes(sched["end_time"])
                if now_minutes > end_min:
                    status = "missed"

            tasks.append({
                "schedule_id":       schedule_id,
                "task_name":         sched.get("task_name", ""),
                "task_type":         sched.get("task_type", ""),
                "start_time":        sched.get("start_time", ""),
                "end_time":          sched.get("end_time", ""),
                "caregiver_required": sched.get("caregiver_required", False),
                "priority":          sched.get("priority", "medium"),
                "status":            status,
                "detected_at":       detected_at,
                "caregiver_present": caregiver_pres,
            })

        tasks.sort(key=lambda x: x["start_time"])

        summary = {k: sum(1 for t in tasks if t["status"] == k)
                   for k in ("done", "late", "missed", "pending", "caregiver_missing")}
        summary["total"] = len(tasks)

        return {
            "patient_id": patient_id,
            "date":       today_str,
            "tasks":      tasks,
            "summary":    summary,
        }

    def get_activity_logs(self, patient_id: str, limit: int = 100) -> list:
        """Return full activity log history (newest first)."""
        logs = list(
            _logs_col()
            .find({"patient_id": patient_id}, {"_id": 0})
            .sort("created_at", -1)
            .limit(limit)
        )
        for log in logs:
            for field in ("detected_at", "created_at"):
                if isinstance(log.get(field), datetime):
                    log[field] = log[field].isoformat()
        return logs
