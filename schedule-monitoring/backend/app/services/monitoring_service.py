"""
schedule-monitoring/backend/app/services/monitoring_service.py
Core business logic:
  - Receives vision detection events
  - Applies the start_time/end_time boundary rule (Early / Completed / Late)
  - Marks tasks Early / Done / Late / Missed / Caregiver-Missing
  - Persists activity logs
  - Triggers notifications

CANONICAL STACK: this file (lowercase statuses, task_name/task_type vocabulary)
is the single source of truth for activity-detection status logic.

STATUS_TO_DISPLAY lives here as the single shared source of truth — both
schedule_controller.py and monitoring_controller.py import it, instead of
each keeping a private copy that can drift out of sync.

FIX (previous revision) — duplicate-log guard now filters FINAL_LOG_STATUSES
in Python instead of relying on a Mongo $in query the mock DB doesn't
reliably support.

FIX (previous revision) — Dashboard Schedule Sidebar & Detection Status Fix
plan: Completed vs Late boundary now uses each activity's own end_time
instead of a fixed 20-minute cutoff, and get_today_status() auto-triggers
evaluate_missed_tasks() so Missed logs get persisted as time passes.

FIX (this revision) — "how early is too early" rule:

Previously, ANY detection up to EARLY_GRACE_MINUTES (30) before an
activity's start_time was accepted and logged as "early", for every
activity in a routine. That's too generous for the very first activity of
the day (a stray early-morning motion 25+ minutes before the first
scheduled activity could get logged against it), and doesn't reflect how
adjacent activities naturally bound each other.

New rule:
  - FIRST activity of the day (chronologically, by start_time, within a
    routine): only accepted as "early" up to FIRST_ACTIVITY_EARLY_GRACE_MINUTES
    (10) minutes before its start_time. Anything earlier than that is
    outside the matching window entirely (no log written — the detection
    simply doesn't match any schedule entry, same as before this fix for
    "too early" cases).
  - EVERY SUBSEQUENT activity: "early" is accepted any time after the
    immediately-preceding activity's end_time, with NO extra minute cap —
    the previous activity's own window naturally bounds how early is
    possible, so an artificial cutoff isn't needed there.

This is computed once per routine in _active_schedules() (sorting that
routine's activities by start_time and carrying forward each activity's own
end_time as the next activity's early-window floor), then consumed in
process_detection_event() as sched["early_window_start_min"] instead of the
old flat "start_min - EARLY_GRACE_MINUTES" calculation.
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
# Used only as a fallback (single-activity/legacy schedules with no
# siblings to bound them, and as the frontend-facing "adaptive_grace_minutes"
# display field) — see FIRST_ACTIVITY_EARLY_GRACE_MINUTES below for the
# value actually used for a routine's first activity.
# How many minutes before start_time the FIRST activity of a routine
# may be detected and still count as "early". Subsequent activities have
# no fixed cap — bounded by the previous activity's end_time instead.
# Also surfaced as the legacy "adaptive_grace_minutes" frontend field.
EARLY_GRACE_MINUTES = 10

# Alias kept so schedule_controller.py import continues to work unchanged.
FIRST_ACTIVITY_EARLY_GRACE_MINUTES = EARLY_GRACE_MINUTES

# NOTE: no longer used to decide Completed vs Late (that boundary is each
# activity's own end_time — see process_detection_event()) — retained only
# because schedule_controller.py's _shape_detection_response() surfaces it
# as a legacy "delay_minutes" display field for the frontend.
LATE_THRESHOLD_MINUTES = 20

# Shared lowercase → capitalized status translation. Single source of truth
# both controllers import from, instead of each keeping a private copy.
STATUS_TO_DISPLAY: dict[str, str] = {
    "early":             "Early",
    "done":              "Completed",
    "late":              "Late",
    "missed":            "Missed",
    "caregiver_missing": "Not Done",   # closest existing frontend bucket for now
    "pending":           "Pending",
}

# Statuses that count as "this activity is finalized for today — don't log
# it again." Pulled out as a constant so the dedup check below and any other
# code that needs the same definition of "final" stay in sync.
FINAL_LOG_STATUSES = ("early", "done", "late", "missed", "caregiver_missing")


# ── Activity → task-type mapping ───────────────────────────────────────────
ACTIVITY_TO_TASK_TYPES: dict[str, list[str]] = {
    "walking":       ["exercise"],
    "sitting / rest": ["rest"],
    "sitting":       ["rest"],
    "sleeping":      ["sleep"],
    "eating":        ["meal"],
    "drinking":      ["hydration"],
    "meal":          ["meal"],
    "hydration":     ["hydration"],
    "rest":          ["rest"],
    "exercise":      ["exercise"],
}

# Canonical map: every label the frontend (LSTM model or threshold classifier)
# can emit → internal activity key used in ACTIVITY_TO_TASK_TYPES.
# All matching is done after .lower() so casing doesn't matter.
FRONTEND_LABEL_TO_ACTIVITY: dict[str, str] = {
    "walking":            "walking",
    "sitting / rest":     "sitting / rest",
    "sitting":            "sitting / rest",
    "sleeping":           "sleeping",
    "eating":             "eating",
    "drinking":           "drinking",
    "standing":           "sitting / rest",
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
                # ── Build valid (idx, act, start_min, end_min) tuples first,
                # so we can sort by start_min to establish chronological
                # neighbor relationships regardless of the order activities
                # happen to be stored in.
                valid = []
                for idx, act in enumerate(activities):
                    if not isinstance(act, dict):
                        continue
                    if not act.get("start_time") or not act.get("end_time"):
                        continue
                    valid.append({
                        "idx": idx,
                        "act": act,
                        "start_min": self._time_to_minutes(act["start_time"]),
                        "end_min": self._time_to_minutes(act["end_time"]),
                    })

                # Chronological order (by start_time) to compute each
                # activity's early-window floor: the first activity gets a
                # fixed FIRST_ACTIVITY_EARLY_GRACE_MINUTES cap; every
                # subsequent activity's floor is simply the previous
                # activity's own end_min — no extra cap needed since that
                # naturally bounds how early a detection could plausibly be.
                chrono = sorted(valid, key=lambda v: v["start_min"])
                schedule_end_min = max(entry["end_min"] for entry in valid)
                early_window_by_idx = {}
                prev_end_min = None
                for i, entry in enumerate(chrono):
                    if i == 0:
                        early_window_by_idx[entry["idx"]] = entry["start_min"] - FIRST_ACTIVITY_EARLY_GRACE_MINUTES
                    else:
                        early_window_by_idx[entry["idx"]] = prev_end_min
                    prev_end_min = entry["end_min"]

                for entry in valid:
                    idx = entry["idx"]
                    act = entry["act"]
                    act_name = act.get("activity_name", "")
                    normalized.append({
                        "patient_id": owner_id,
                        "schedule_id": f"{base_schedule_id}::{idx}",
                        "source_schedule_id": base_schedule_id,
                        "task_name": act_name,
                        "activity_name": act_name,
                        "task_type": _infer_task_type(act_name),
                        "start_time": act.get("start_time"),
                        "end_time": act.get("end_time"),
                        "early_window_start_min": early_window_by_idx[idx],
                        "schedule_end_min": schedule_end_min,
                        "caregiver_required": bool(act.get("caregiver_required", doc.get("caregiver_required", False))),
                        "priority": act.get("priority", doc.get("priority", "medium")),
                    })
                continue
            if doc.get("start_time") and doc.get("end_time"):
                task_name = doc.get("task_name") or doc.get("activity_name", "")
                start_min = self._time_to_minutes(doc["start_time"])
                normalized.append({
                    "patient_id": owner_id,
                    "schedule_id": base_schedule_id,
                    "source_schedule_id": base_schedule_id,
                    "task_name": task_name,
                    "activity_name": doc.get("activity_name", task_name),
                    "task_type": doc.get("task_type", _infer_task_type(task_name)),
                    "start_time": doc.get("start_time"),
                    "end_time": doc.get("end_time"),
                    # Legacy single-activity schedule — no siblings to bound
                    # it, so treat it like a routine's "first" activity.
                    "early_window_start_min": start_min - FIRST_ACTIVITY_EARLY_GRACE_MINUTES,
                    "schedule_end_min": self._time_to_minutes(doc["end_time"]),
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
            ts = datetime.utcnow()
        elif isinstance(ts, str):
            try:
                ts = datetime.fromisoformat(ts.replace("Z", ""))
            except Exception:
                ts = datetime.utcnow()

        matched_task_types = ACTIVITY_TO_TASK_TYPES.get(activity, [activity])
        schedules    = self._active_schedules(patient_id)
        today_str    = ts.strftime("%Y-%m-%d")
        now_seconds  = ts.hour * 3600 + ts.minute * 60 + ts.second

        results = []
        for sched in schedules:
            task_type = sched.get("task_type", "")
            if task_type not in matched_task_types:
                continue

            start_min = self._time_to_minutes(sched["start_time"])
            end_min   = self._time_to_minutes(sched["end_time"])

            # Lower bound: this activity's own computed early-window floor
            # (10 min before start for the first activity of the day, or
            # the previous activity's end_time for every activity after
            # that) — NOT a flat EARLY_GRACE_MINUTES subtraction from
            # start_min anymore.
            window_open = sched.get("early_window_start_min", start_min - EARLY_GRACE_MINUTES) * 60
            window_close = sched.get("schedule_end_min", end_min) * 60
            if now_seconds < window_open or now_seconds > window_close:
                continue

            schedule_id = str(sched.get("schedule_id", sched.get("_id", "")))

            # Dedup guard: check if a final-status log already exists
            # for this schedule+date.  We read it atomically before deciding
            # to write, so parallel callers (poll + sweep thread) can't
            # both pass the guard and write duplicate rows.
            existing = _logs_col().find_one({
                "schedule_id": schedule_id,
                "date": today_str,
                "status": {"$in": list(FINAL_LOG_STATUSES)},
            })
            if existing:
                continue

            # Completed/Late boundary is this activity's own end_time, not a
            # fixed threshold. Early is anything before start_time that
            # still falls within the early-window floor checked above.
            if now_seconds < start_min * 60:
                status = "early"
            elif now_seconds < start_min * 60 + 30:
                status = "done"        # within scheduled window = Completed
            else:
                status = "late"        # after end_time = Late

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
                "created_at":        datetime.utcnow(),
            }
            _logs_col().insert_one(log_entry)

            _schedules_col().update_one(
                {"schedule_id": sched.get("source_schedule_id", schedule_id)},
                {"$set": {"today_status": status, "detected_at": ts}},
            )

            if status in FINAL_LOG_STATUSES:
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

        if results:
            from app.services.schedule_service import ScheduleService
            for schedule_id in {result.get("schedule_id", "").split("::")[0] for result in results}:
                ScheduleService().finalize_if_complete(schedule_id)

        return {"matched": len(results), "results": results}

    def evaluate_missed_tasks(self, patient_id: str = "patient_001") -> dict:
        """Mark activities missed after the late detection allowance expires.
        This keeps the late state available after the scheduled window closes."""
        schedules    = self._active_schedules(patient_id)
        now          = datetime.now()
        now_seconds  = now.hour * 3600 + now.minute * 60 + now.second
        today_str    = now.strftime("%Y-%m-%d")
        missed_count = 0

        from app.services.notification_service import NotificationService
        ns = NotificationService()

        schedule_end_by_id = {
            sched.get("source_schedule_id", sched.get("schedule_id")): sched.get(
                "schedule_end_min", self._time_to_minutes(sched["end_time"])
            )
            for sched in schedules
        }

        for sched in schedules:
            source_schedule_id = sched.get("source_schedule_id", sched.get("schedule_id"))
            if now_seconds <= schedule_end_by_id[source_schedule_id] * 60:
                continue

            schedule_id = str(sched.get("schedule_id", sched.get("_id", "")))

            # Atomic upsert: only inserts when no log exists for this
            # schedule_id+date yet; concurrent callers both lose the race
            # to the same upsert key and skip the notification safely.
            result = _logs_col().update_one(
                {"schedule_id": schedule_id, "date": today_str},
                {"$setOnInsert": {
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
                }},
                upsert=True,
            )
            # upserted_id is set only when a new document was inserted,
            # not when an existing one was matched.
            if not result.upserted_id:
                continue  # already existed — another caller beat us

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
        # Auto-trigger missed evaluation so any activity whose window has
        # already closed with no detection gets written to the DB as
        # "missed" before we read status back out below, instead of only
        # being inferred on the fly (and never persisted) as before.
        self.evaluate_missed_tasks(patient_id)

        schedules   = self._active_schedules(patient_id)
        now         = datetime.utcnow()
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
                schedule_end_min = sched.get("schedule_end_min", self._time_to_minutes(sched["end_time"]))
                if now_minutes > schedule_end_min:
                    status = "missed"

            tasks.append({
                "schedule_id":       schedule_id,
                "task_name":         sched.get("task_name", ""),
                "task_type":         sched.get("task_type", ""),
                "start_time":        sched.get("start_time", ""),
                "end_time":          sched.get("end_time", ""),
                "caregiver_required": sched.get("caregiver_required", False),
                "priority":          sched.get("priority", "medium"),
                # display_status added alongside the raw lowercase "status"
                # (kept for backward compatibility with anything else
                # reading this field), so callers can show either.
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
            raw_status = log.get("status", "")
            log["display_status"] = STATUS_TO_DISPLAY.get(raw_status, raw_status.title() if raw_status else "Planned")
        return logs