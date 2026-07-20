"""
schedule-monitoring/backend/app/services/monitoring_service.py
Core business logic:
  - Receives vision detection events
  - Applies the 20-minute validation rule
  - Marks tasks Early / Done / Late / Missed / Caregiver-Missing
  - Persists activity logs
  - Triggers notifications

CANONICAL STACK: this file (lowercase statuses, task_name/task_type vocabulary)
is now the single source of truth for activity-detection status logic and the
20-minute rule.

NEW (this version): STATUS_TO_DISPLAY moved here from schedule_controller.py
so it's a single shared source of truth. Previously schedule_controller.py
had its own private copy (_STATUS_TO_DISPLAY) used to translate responses for
the detection-logging endpoint, but monitoring_controller.py's
get_activity_logs() and get_today_status() had NO translation at all — they
returned the raw lowercase statuses straight from the database. That meant
ScheduleDashboard.jsx (which checks for "Completed"/"Early"/"Late"/"Missed")
never matched anything from the logs endpoint, even after a real detection
was correctly logged, so every activity displayed as "Planned" regardless of
what was actually detected. Both controllers now import this one dict.
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


# ── Config ──────────────────────────────────────────────────────────────────
EARLY_GRACE_MINUTES = 30
LATE_THRESHOLD_MINUTES = 20

# NEW: shared lowercase → capitalized status translation. This is the single
# source of truth both controllers import from, instead of each keeping a
# private copy that can drift out of sync (which is exactly how the
# activity-logs endpoint ended up untranslated while the detection endpoint
# was fixed).
STATUS_TO_DISPLAY: dict[str, str] = {
    "early":             "Early",
    "done":              "Completed",
    "late":              "Late",
    "missed":            "Missed",
    "caregiver_missing": "Not Done",   # closest existing frontend bucket for now
    "pending":           "Pending",
}


# ── Activity → task-type mapping ───────────────────────────────────────────
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

FRONTEND_LABEL_TO_ACTIVITY: dict[str, str] = {
    "sitting / rest":      "sitting",
    "taking medications":  "medication",
    "standing":            "rest",
}


def _normalize_status(value: str) -> str:
    if not value:
        return "pending"
    lowered = str(value).strip().lower().replace(" ", "_")
    aliases = {
        "on_time": "done",
        "completed": "done",
        "not_done": "missed",
    }
    return aliases.get(lowered, lowered)


def _infer_task_type(activity_name: str) -> str:
    name = (activity_name or "").lower()
    if any(k in name for k in ("eat", "meal", "breakfast", "lunch", "dinner", "food")):
        return "meal"
    if any(k in name for k in ("drink", "water", "hydration")):
        return "hydration"
    if any(k in name for k in ("sleep", "bed", "lying", "nap")):
        return "sleep"
    if any(k in name for k in ("rest", "sit")):
        return "rest"
    if any(k in name for k in ("walk", "exercise", "therapy", "physio", "move")):
        return "exercise"
    if any(k in name for k in ("med", "pill", "tablet", "medicine")):
        return "medication"
    return "other"


class MonitoringService:
    @staticmethod
    def _time_to_minutes(time_str: str) -> int:
        h, m = map(int, time_str.split(":"))
        return h * 60 + m

    def _active_schedules(self, patient_id: str) -> list:
        today_abbr = datetime.now().strftime("%a")
        all_docs = list(_schedules_col().find({}))
        raw_docs = [
            d for d in all_docs
            if d.get("patient_id") == patient_id or d.get("user_id") == patient_id
        ]
        normalized = []
        for doc in raw_docs:
            if doc.get("active", True) is False:
                continue
            repeat_days = doc.get("repeat_days", []) or []
            if repeat_days and today_abbr not in repeat_days:
                continue
            base_schedule_id = str(doc.get("schedule_id", doc.get("_id", "")))
            owner_id = doc.get("patient_id") or doc.get("user_id") or patient_id
            activities = doc.get("activities", [])
            if isinstance(activities, list) and activities:
                for idx, act in enumerate(activities):
                    if not isinstance(act, dict):
                        continue
                    act_name = act.get("activity_name", "")
                    if not act.get("start_time") or not act.get("end_time"):
                        continue
                    normalized.append({
                        "patient_id": owner_id,
                        "schedule_id": f"{base_schedule_id}::{idx}",
                        "source_schedule_id": base_schedule_id,
                        "task_name": act_name,
                        "activity_name": act_name,
                        "task_type": _infer_task_type(act_name),
                        "start_time": act.get("start_time"),
                        "end_time": act.get("end_time"),
                        "caregiver_required": bool(act.get("caregiver_required", doc.get("caregiver_required", False))),
                        "priority": act.get("priority", doc.get("priority", "medium")),
                    })
                continue
            if doc.get("start_time") and doc.get("end_time"):
                task_name = doc.get("task_name") or doc.get("activity_name", "")
                normalized.append({
                    "patient_id": owner_id,
                    "schedule_id": base_schedule_id,
                    "source_schedule_id": base_schedule_id,
                    "task_name": task_name,
                    "activity_name": doc.get("activity_name", task_name),
                    "task_type": doc.get("task_type", _infer_task_type(task_name)),
                    "start_time": doc.get("start_time"),
                    "end_time": doc.get("end_time"),
                    "caregiver_required": bool(doc.get("caregiver_required", False)),
                    "priority": doc.get("priority", "medium"),
                })
        return normalized

    def process_detection_event(self, event: dict) -> dict:
        patient_id  = event.get("patient_id", "patient_001")
        raw_activity = event.get("detected_activity", "").lower()
        activity    = FRONTEND_LABEL_TO_ACTIVITY.get(raw_activity, raw_activity)
        caregiver_p = event.get("caregiver_present", False)
        caregiver_id = event.get("caregiver_id")
        confidence  = event.get("confidence", 0.0)

        ts = event.get("timestamp")
        if ts is None:
            ts = datetime.now()
        elif isinstance(ts, str):
            try:
                ts = datetime.fromisoformat(ts.replace("Z", ""))
            except Exception:
                ts = datetime.now()

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

            window_open  = start_min - EARLY_GRACE_MINUTES
            window_close = end_min + 30
            if now_minutes < window_open or now_minutes > window_close:
                continue

            schedule_id = str(sched.get("schedule_id", sched.get("_id", "")))

            existing = _logs_col().find_one({
                "schedule_id": schedule_id,
                "date": today_str,
                "status": {"$in": ["early", "done", "late", "missed", "caregiver_missing"]},
            })
            if existing:
                continue

            threshold = start_min + LATE_THRESHOLD_MINUTES
            if now_minutes < start_min:
                status = "early"
            elif now_minutes <= threshold:
                status = "done"
            else:
                status = "late"

            if sched.get("caregiver_required", False) and not caregiver_p:
                status = "caregiver_missing"

            log_entry = {
                "log_id":            str(uuid.uuid4()),
                "patient_id":        patient_id,
                "schedule_id":       schedule_id,
                "task_name":         sched.get("task_name", ""),
                "activity_name":     sched.get("activity_name", sched.get("task_name", "")),
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
                "created_at":        datetime.now(),
            }
            _logs_col().insert_one(log_entry)

            _schedules_col().update_one(
                {"schedule_id": sched.get("source_schedule_id", schedule_id)},
                {"$set": {"today_status": status, "detected_at": ts}},
            )

            if status in ("done", "early", "late", "missed", "caregiver_missing"):
                from app.services.notification_service import NotificationService
                ns = NotificationService()
                msgs = {
                    "done": f"✅ {sched.get('task_name')} was completed on time at {ts.strftime('%H:%M')}.",
                    "early": f"🟢 {sched.get('task_name')} was completed early at {ts.strftime('%H:%M')}.",
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
                "activity_name": sched.get("activity_name", sched.get("task_name")),
                "status":      status,
                "start_time":  sched.get("start_time"),
                "end_time":    sched.get("end_time"),
            })

        return {"matched": len(results), "results": results}

    def evaluate_missed_tasks(self, patient_id: str = "patient_001") -> dict:
        schedules    = self._active_schedules(patient_id)
        now          = datetime.now()
        now_minutes  = now.hour * 60 + now.minute
        today_str    = now.strftime("%Y-%m-%d")
        missed_count = 0

        from app.services.notification_service import NotificationService
        ns = NotificationService()

        for sched in schedules:
            end_min = self._time_to_minutes(sched["end_time"])
            if now_minutes <= end_min:
                continue

            schedule_id = str(sched.get("schedule_id", sched.get("_id", "")))

            if _logs_col().find_one({"schedule_id": schedule_id, "date": today_str}):
                continue

            _logs_col().insert_one({
                "log_id":            str(uuid.uuid4()),
                "patient_id":        patient_id,
                "schedule_id":       schedule_id,
                "task_name":         sched.get("task_name", ""),
                "activity_name":     sched.get("activity_name", sched.get("task_name", "")),
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
                {"schedule_id": sched.get("source_schedule_id", schedule_id)},
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

    def get_today_status(self, patient_id: str) -> dict:
        schedules   = self._active_schedules(patient_id)
        now         = datetime.now()
        today_str   = now.strftime("%Y-%m-%d")
        now_minutes = now.hour * 60 + now.minute

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
                # NEW: display_status added alongside the raw lowercase
                # "status" (kept for backward compatibility with anything
                # else reading this field), so callers can show either.
                "status":            status,
                "display_status":    STATUS_TO_DISPLAY.get(status, status.title()),
                "detected_at":       detected_at,
                "caregiver_present": caregiver_pres,
            })

        tasks.sort(key=lambda x: x["start_time"])
        summary = {k: sum(1 for t in tasks if t["status"] == k)
                   for k in ("early", "done", "late", "missed", "pending", "caregiver_missing")}
        summary["total"] = len(tasks)

        return {
            "patient_id": patient_id,
            "date":       today_str,
            "tasks":      tasks,
            "summary":    summary,
        }

    def get_activity_logs(self, patient_id: str, limit: int = 100) -> list:
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
            # NEW: this is the actual fix for your reported bug. Previously
            # this list was returned with the raw lowercase "status"
            # ("done"/"early"/"late"/"missed") and nothing else — the
            # frontend's ScheduleDashboard.jsx checks for "Completed"/
            # "Early"/"Late"/"Missed" and never matched, so every activity
            # displayed as "Planned" / 0% no matter what was really detected.
            raw_status = log.get("status", "")
            log["display_status"] = STATUS_TO_DISPLAY.get(raw_status, raw_status.title() if raw_status else "Planned")
        return logs