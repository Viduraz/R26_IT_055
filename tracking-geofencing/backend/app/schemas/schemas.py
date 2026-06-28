"""
MongoDB document schemas for the tracking-geofencing service.
These define the structure of documents stored in MongoDB collections.
"""

# ── tracking_logs collection ─────────────────────────────────────
TRACKING_LOG_SCHEMA = {
    "person_id": str,        # Unique person identifier (e.g. "person_001")
    "bounding_box": {        # Detection bounding box
        "x": float,
        "y": float,
        "w": float,
        "h": float,
    },
    "confidence": float,     # Detection confidence (0.0 - 1.0)
    "zone_status": str,      # "safe" | "restricted" | "alert" | "unknown"
    "timestamp": str,        # ISO 8601 timestamp
    "frame_id": str,         # UUID of the processed frame
}

# ── geofence_zones collection ────────────────────────────────────
GEOFENCE_ZONE_SCHEMA = {
    "zone_id": str,          # UUID v4
    "name": str,             # Human readable zone name
    "zone_type": str,        # "safe" | "restricted" | "alert"
    "polygon": list,         # [[x, y], [x, y], ...] coordinates
    "color": str,            # Hex color code
    "is_active": bool,       # Whether zone is actively monitored
    "created_at": str,       # ISO 8601 timestamp
}

# ── geofence_alerts collection ───────────────────────────────────
GEOFENCE_ALERT_SCHEMA = {
    "alert_id": str,         # UUID v4
    "person_id": str,        # Person who triggered the alert
    "zone_id": str,          # Zone that was breached
    "zone_name": str,        # Human readable zone name
    "breach_type": str,      # "entry" | "exit"
    "timestamp": str,        # ISO 8601 timestamp
    "resolved": bool,        # Whether alert has been resolved
}
