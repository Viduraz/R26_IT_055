"""
anomaly-detection/backend/app/services/alert_service.py
Logs structured anomaly events to MongoDB and sends to gateway alerts.
"""
from datetime import datetime, timezone
from shared.backend.config.database import get_db


def log_alert(event: dict, person_id: str, caregiver_id: str, session_id: str, evidence: dict):
    """
    Persist a structured anomaly alert to MongoDB.
    The gateway dashboard reads from anomaly_alerts for its Alerts Center.
    """
    try:
        db = get_db()
        doc = {
            "anomaly_type":  event.get("anomaly_type"),
            "confidence":    event.get("confidence"),
            "severity":      event.get("severity"),
            "source":        event.get("source"),
            "person_id":     person_id,
            "caregiver_id":  caregiver_id,
            "session_id":    session_id,
            "timestamp":     datetime.now(timezone.utc).isoformat(),
            "lstm_used":     event.get("lstm_used", False),
            "ae_used":       event.get("ae_used", False),
            "ae_error":      event.get("ae_error"),
            "evidence":      evidence,
        }
        db["anomaly_alerts"].insert_one(doc)

        # Also write to general anomaly_logs for history page
        db["anomaly_logs"].insert_one({**doc, "anomaly_detected": event.get("anomaly_type") != "normal_activity"})

        # Dispatch urgent caregiver alert if severity is high/critical
        if doc["severity"] in ("critical", "high"):
            _dispatch_caregiver_alert(doc)

    except Exception as e:
        print(f"[ERROR] alert_service.log_alert: {repr(e)}")


def _dispatch_caregiver_alert(alert_doc: dict):
    """
    Simulate an urgent alert notification system (e.g. SMS, Email, or Web Push).
    In production, this hooks into Twilio (SMS) or SendGrid (Email).
    """
    print("\n" + "="*80)
    print("🚨 URGENT CAREGIVER NOTIFICATION DISPATCHED")
    print(f"   Patient ID:   {alert_doc['person_id']}")
    print(f"   Event Type:   {alert_doc['anomaly_type'].upper().replace('_', ' ')}")
    print(f"   Severity:     {alert_doc['severity'].upper()}")
    print(f"   Confidence:   {alert_doc['confidence'] * 100:.1f}%")
    print(f"   Timestamp:    {alert_doc['timestamp']}")
    print(f"   Details:      {alert_doc['evidence']}")
    print("="*80 + "\n")
