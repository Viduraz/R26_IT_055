"""
anomaly-detection/backend/app/services/alert_service.py

Phase 2 — Structured alert system with:
  - Cooldown deduplication (no spam alerts within 8 seconds per person+event)
  - Structured JSON alert format
  - In-memory alert registry (last 200 alerts)
  - Persistent session JSON log file (logs/session_alerts.jsonl)
  - MongoDB persistence
  - Caregiver console dispatch for critical/high events
"""
import os
import json
import time
from datetime import datetime, timezone
from threading import Lock
from shared.backend.config.database import get_db

# ── Configuration ─────────────────────────────────────────────────────────────
COOLDOWN_SECONDS = 8       # suppress duplicate alerts within this window
MAX_MEMORY_ALERTS = 200    # in-memory alert ring buffer size
LOG_DIR  = os.path.join(os.path.dirname(__file__), "..", "..", "..", "logs")
LOG_FILE = os.path.join(LOG_DIR, "session_alerts.jsonl")

# ── In-memory state ───────────────────────────────────────────────────────────
_memory_alerts: list[dict] = []          # last N alerts in memory
_cooldown_map:  dict[str, float] = {}    # key: "person_id:event" → last_alert_unix
_lock = Lock()


# ── Public API ────────────────────────────────────────────────────────────────

def log_alert(event: dict, person_id: str, caregiver_id: str,
              session_id: str, evidence: dict) -> None:
    """
    Persist a structured anomaly alert.
    Silently drops duplicate alerts within the cooldown window.
    """
    anomaly_type = event.get("anomaly_type", "unknown")
    severity     = event.get("severity", "none")
    confidence   = event.get("confidence", 0.0)

    # ── Cooldown deduplication ────────────────────────────────────────────────
    cooldown_key = f"{person_id}:{anomaly_type}"
    now = time.monotonic()
    with _lock:
        last = _cooldown_map.get(cooldown_key, 0.0)
        if now - last < COOLDOWN_SECONDS:
            return   # suppress — still within cooldown window
        _cooldown_map[cooldown_key] = now

    # ── Build structured alert document ──────────────────────────────────────
    ts = datetime.now(timezone.utc).isoformat()
    doc = {
        "timestamp":     ts,
        "event":         anomaly_type,
        "severity":      severity,
        "confidence":    round(confidence, 4),
        "motion_score":  round(evidence.get("pose_energy",  0.0), 5),
        "wrist_velocity": round(evidence.get("wrist_velocity", 0.0), 4),
        "patient_id":    person_id,
        "caregiver_id":  caregiver_id,
        "session_id":    session_id,
        "source":        event.get("source", "unknown"),
        "lstm_used":     event.get("lstm_used", False),
        "ae_used":       event.get("ae_used", False),
        "ae_error":      event.get("ae_error"),
        "evidence":      evidence,
    }

    # ── Persist to MongoDB ────────────────────────────────────────────────────
    try:
        db = get_db()
        db["anomaly_alerts"].insert_one({**doc})
        db["anomaly_logs"].insert_one({**doc, "anomaly_detected": True})
    except Exception as e:
        print(f"[WARN] alert_service MongoDB write failed: {repr(e)}")

    # ── Persist to session JSON log file ─────────────────────────────────────
    _append_to_log_file(doc)

    # ── Store in in-memory ring buffer ────────────────────────────────────────
    with _lock:
        _memory_alerts.append(doc)
        if len(_memory_alerts) > MAX_MEMORY_ALERTS:
            _memory_alerts.pop(0)

    # ── Dispatch caregiver notification for high/critical ─────────────────────
    if severity in ("critical", "high"):
        _dispatch_caregiver_alert(doc)


def get_memory_alerts(limit: int = 50) -> list[dict]:
    """Return the last `limit` alerts from the in-memory buffer."""
    with _lock:
        return list(_memory_alerts[-limit:])


def get_session_logs() -> list[dict]:
    """Read and return all alerts from the current session log file."""
    if not os.path.exists(LOG_FILE):
        return []
    logs = []
    try:
        with open(LOG_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    logs.append(json.loads(line))
    except Exception as e:
        print(f"[WARN] session log read error: {repr(e)}")
    return logs


# ── Internal helpers ──────────────────────────────────────────────────────────

def _append_to_log_file(doc: dict) -> None:
    """Append one JSON line to the session log file."""
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        # Remove MongoDB-specific fields before writing
        clean = {k: v for k, v in doc.items() if k != "_id_omit"}
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(clean, default=str) + "\n")
    except Exception as e:
        print(f"[WARN] session log write error: {repr(e)}")


def _dispatch_caregiver_alert(alert_doc: dict) -> None:
    """
    Console notification for high/critical severity events.
    In production: hook into Twilio SMS / SendGrid email / WebPush.
    """
    sev  = alert_doc["severity"].upper()
    evt  = alert_doc["event"].upper().replace("_", " ")
    pid  = alert_doc["patient_id"]
    conf = alert_doc["confidence"] * 100
    ts   = alert_doc["timestamp"]
    ev   = alert_doc.get("evidence", {})

    print("\n" + "=" * 72)
    print(f"[ALERT] {sev} | {evt}")
    print(f"  Patient   : {pid}")
    print(f"  Confidence: {conf:.1f}%")
    print(f"  Timestamp : {ts}")
    print(f"  Evidence  : {ev}")
    print("=" * 72 + "\n")
