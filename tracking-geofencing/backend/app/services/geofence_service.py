"""
Geofence business logic service.
Handles zone CRUD, breach detection using Shapely, and alert management.
Includes smart exit detection: tracks per-person zone history and fires
alerts when a person disappears from the camera after being inside a zone.
All DB operations wrapped in try/except to survive MongoDB being down.
"""

import uuid
import time
from datetime import datetime, timezone
from shapely.geometry import Point, Polygon
from app.database.db import get_database


# ── Person Exit Tracker (in-memory singleton) ─────────────────────
# { person_id: { "last_zone": str|None, "last_seen": float,
#                "identity": str, "exit_alerted": bool,
#                "max_area_in_zone": float, "last_area": float } }
person_exit_tracker: dict = {}


def _point_in_polygon(centroid: tuple, polygon: list) -> bool:
    """Check if centroid (x, y) is inside polygon [[x,y], ...]."""
    if len(polygon) < 3:
        return False
    try:
        return Polygon(polygon).contains(Point(centroid))
    except Exception:
        return False


async def update_person_zone_status(
    person_id: str,
    identity: str,
    bbox: dict,
    zones: list,
):
    """Called every frame for each detected person to track zone occupancy and depth."""
    now = time.time()
    
    feet = (bbox["x"] + bbox["w"] / 2, bbox["y"] + bbox["h"])
    area = bbox["w"] * bbox["h"]
    bottom_y = bbox["y"] + bbox["h"]

    # Estimate depth from camera (depth = 850 / bbox_height)
    person_w = bbox.get("w", 0)
    person_h = bbox.get("h", 100)
    aspect_ratio = (person_w / person_h) if person_h > 0 else 0.0
    is_sitting = aspect_ratio >= 0.55

    # Correct height for sitting posture to avoid artificial depth inflation
    effective_h = max(person_h, person_w / 0.45) if is_sitting else person_h
    distance_meters = 850.0 / effective_h if effective_h > 0 else 0.0

    for zone in zones:
        if zone.get("is_active") and _point_in_polygon(feet, zone.get("polygon", [])):
            zone_dist = zone.get("camera_distance", 4.0)
            if zone.get("zone_type") == "restricted":
                # Persons sitting in chairs or in front of the zone should not trigger restricted zone entry alerts
                if is_sitting or distance_meters < zone_dist - 0.5:
                    continue
            current_zone = zone["name"]
            break

    if person_id not in person_exit_tracker:
        person_exit_tracker[person_id] = {
            "last_zone": current_zone,
            "last_seen": now,
            "identity": identity,
            "exit_alerted": False,
            "max_area_in_zone": area if current_zone else 0,
            "last_area": area,
        }
    else:
        tracker = person_exit_tracker[person_id]
        previous_zone = tracker["last_zone"]
        
        # Depth-aware exit detection: If they just left the zone and are smaller (further away)
        if previous_zone and not current_zone and not tracker["exit_alerted"]:
            # If their current area is noticeably smaller than the max area they had while in the zone,
            # or their feet (bottom_y) are significantly higher up (smaller y) than when they were in the zone,
            # it means they went BEHIND the zone threshold (exited the room).
            if area < tracker["max_area_in_zone"] * 0.85:
                # They shrank -> walked behind/away through the door!
                tracker["exit_alerted"] = True
                await _trigger_exit_alert(person_id, tracker.get("identity", "Unknown"), previous_zone)

        # Update tracker state
        tracker["last_seen"] = now
        tracker["identity"] = identity
        tracker["last_area"] = area
        
        if current_zone:
            tracker["last_zone"] = current_zone
            tracker["max_area_in_zone"] = max(tracker.get("max_area_in_zone", 0), area)
            tracker["exit_alerted"] = False  # Reset if they re-enter a zone
        else:
            # Gradually decay max area if they are wandering outside the zone
            tracker["max_area_in_zone"] = tracker.get("max_area_in_zone", 0) * 0.99


async def _trigger_exit_alert(person_id: str, identity: str, zone_name: str) -> dict:
    """Helper to create and save an exit alert."""
    alert = {
        "alert_id": str(uuid.uuid4()),
        "alert_type": "zone_exit",
        "person_id": person_id,
        "identity": identity,
        "last_zone": zone_name,
        "zone_name": zone_name,
        "breach_type": "exit",
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "message": f"{identity if identity != 'Unknown' else person_id} has left the {zone_name} area",
        "resolved": False,
        "severity": "high",
    }
    try:
        db = get_database()
        if db:
            await db["geofence_alerts"].insert_one(alert.copy())
    except Exception as e:
        print(f"[WARN] Alert save error: {e}")
    return alert


async def check_for_exits(currently_tracked_ids: list) -> list:
    """
    Called every frame with list of person IDs currently visible.
    Persons in tracker but NOT in currently_tracked_ids have disappeared.
    If they were last seen INSIDE a zone → EXIT ALERT.
    """
    now = time.time()
    exit_alerts = []

    for person_id, data in list(person_exit_tracker.items()):
        if person_id in currently_tracked_ids:
            continue  # still visible, handled by update_person_zone_status depth logic

        time_since_seen = now - data["last_seen"]

        # Person disappeared 1-5 seconds ago (not just momentary occlusion)
        if 1.0 < time_since_seen < 5.0 and not data["exit_alerted"]:
            last_zone = data.get("last_zone")

            # Only alert if they were in SOME zone when last seen
            # And check if they were shrinking before they disappeared (went behind)
            if last_zone and data.get("last_area", 0) < data.get("max_area_in_zone", 0) * 0.9:
                person_exit_tracker[person_id]["exit_alerted"] = True
                alert = await _trigger_exit_alert(person_id, data.get("identity", "Unknown"), last_zone)
                alert.pop("_id", None)
                exit_alerts.append(alert)

        # Clean up very old entries (>30 seconds gone)
        if time_since_seen > 30:
            del person_exit_tracker[person_id]

    return exit_alerts


async def get_exit_alerts(limit: int = 20) -> list:
    """Return recent exit-type alerts from geofence_alerts."""
    try:
        db = get_database()
        if db is None:
            return []
        cursor = (
            db["geofence_alerts"]
            .find({"alert_type": "zone_exit"}, {"_id": 0})
            .sort("timestamp", -1)
            .limit(limit)
        )
        alerts = await cursor.to_list(length=limit)
        return alerts
    except Exception as e:
        print(f"[WARN] DB error in get_exit_alerts: {e}")
        return []


# ── Original CRUD / Breach / Alert functions (unchanged) ──────────

async def create_zone(name: str, zone_type: str, polygon: list, color: str = "#00D4FF", camera_distance: float = 4.0) -> dict:
    """Create a new geofence zone."""
    zone = {
        "zone_id": str(uuid.uuid4()),
        "name": name,
        "zone_type": zone_type,
        "polygon": polygon,
        "color": color,
        "camera_distance": camera_distance,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        db = get_database()
        if db is not None:
            await db["geofence_zones"].insert_one(zone)
            zone.pop("_id", None)
        return zone
    except Exception as e:
        print(f"[WARN] DB error in create_zone: {e}")
        zone.pop("_id", None)
        return zone


async def get_all_zones() -> list:
    """Retrieve all geofence zones."""
    try:
        db = get_database()
        if db is None:
            return []
        cursor = db["geofence_zones"].find({}, {"_id": 0})
        zones = await cursor.to_list(length=200)
        return zones
    except Exception as e:
        print(f"[WARN] DB error in get_all_zones: {e}")
        return []


async def get_zone(zone_id: str) -> dict:
    """Retrieve a single zone by its zone_id."""
    try:
        db = get_database()
        if db is None:
            return None
        zone = await db["geofence_zones"].find_one({"zone_id": zone_id}, {"_id": 0})
        return zone
    except Exception as e:
        print(f"[WARN] DB error in get_zone: {e}")
        return None


async def update_zone(zone_id: str, update_data: dict) -> dict:
    """Update an existing zone. Returns updated zone or None if not found."""
    try:
        db = get_database()
        if db is None:
            return None
        clean_update = {k: v for k, v in update_data.items() if v is not None}
        if not clean_update:
            return await get_zone(zone_id)

        result = await db["geofence_zones"].update_one(
            {"zone_id": zone_id},
            {"$set": clean_update}
        )
        if result.matched_count == 0:
            return None
        return await get_zone(zone_id)
    except Exception as e:
        print(f"[WARN] DB error in update_zone: {e}")
        return None


async def delete_zone(zone_id: str) -> bool:
    """Delete a zone by its zone_id. Returns True if deleted."""
    try:
        db = get_database()
        if db is None:
            return False
        result = await db["geofence_zones"].delete_one({"zone_id": zone_id})
        return result.deleted_count > 0
    except Exception as e:
        print(f"[WARN] DB error in delete_zone: {e}")
        return False


async def check_breach(person_id: str, x: float, y: float) -> dict:
    """Check if a point (x, y) falls inside any active geofence zone."""
    try:
        db = get_database()
        if db is None:
            return {"person_id": person_id, "breaches": [], "is_breached": False}

        # Look up the tracked person to get their height and posture for depth estimation
        from app.ml_services.yolo_tracker import tracker_engine
        person_info = tracker_engine.bytetrack_tracked.get(person_id) or tracker_engine.deepsort_tracked.get(person_id)
        
        person_w = person_info.bbox.get("w", 0) if (person_info and person_info.bbox) else 0
        person_h = person_info.bbox.get("h", 100) if (person_info and person_info.bbox) else 100
        aspect_ratio = (person_w / person_h) if person_h > 0 else 0.0
        is_sitting = getattr(person_info, "is_sitting", aspect_ratio >= 0.55) if person_info else (aspect_ratio >= 0.55)

        effective_h = max(person_h, person_w / 0.45) if is_sitting else person_h
        distance_meters = 850.0 / effective_h if effective_h > 0 else 0.0

        point = Point(x, y)
        cursor = db["geofence_zones"].find({"is_active": True}, {"_id": 0})
        zones = await cursor.to_list(length=200)

        breaches = []
        for zone in zones:
            poly_coords = zone.get("polygon", [])
            if len(poly_coords) < 3:
                continue

            # Verify depth & posture for restricted zones to prevent false positives when person is sitting or in front
            zone_dist = zone.get("camera_distance", 4.0)
            if zone["zone_type"] == "restricted":
                if is_sitting or distance_meters < zone_dist - 0.5:
                    continue

            polygon = Polygon(poly_coords)
            if polygon.contains(point):
                if zone["zone_type"] == "safe":
                    continue

                breach_type = "entry"
                alert = {
                    "alert_id": str(uuid.uuid4()),
                    "person_id": person_id,
                    "zone_id": zone["zone_id"],
                    "zone_name": zone["name"],
                    "breach_type": breach_type,
                    "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                    "resolved": False,
                }
                try:
                    await db["geofence_alerts"].insert_one(alert)
                    alert.pop("_id", None)
                except Exception as e:
                    print(f"[WARN] Failed to save alert: {e}")
                    alert.pop("_id", None)
                breaches.append(alert)

        return {
            "person_id": person_id,
            "breaches": breaches,
            "is_breached": len(breaches) > 0,
        }
    except Exception as e:
        print(f"[WARN] DB error in check_breach: {e}")
        return {"person_id": person_id, "breaches": [], "is_breached": False}


async def get_alerts(resolved: bool = None, since: str = None) -> list:
    """Retrieve geofence alerts, optionally filtered by resolved status and since timestamp."""
    try:
        db = get_database()
        if db is None:
            return []
        query = {}
        if resolved is not None:
            query["resolved"] = resolved
        if since is not None:
            query["timestamp"] = {"$gte": since}
        cursor = db["geofence_alerts"].find(query, {"_id": 0}).sort("timestamp", -1).limit(50)
        alerts = await cursor.to_list(length=50)
        return alerts
    except Exception as e:
        print(f"[WARN] DB error in get_alerts: {e}")
        return []


async def resolve_alert(alert_id: str) -> dict:
    """Mark an alert as resolved."""
    try:
        db = get_database()
        if db is None:
            return None
        result = await db["geofence_alerts"].update_one(
            {"alert_id": alert_id},
            {"$set": {"resolved": True}}
        )
        if result.matched_count == 0:
            return None
        alert = await db["geofence_alerts"].find_one({"alert_id": alert_id}, {"_id": 0})
        return alert
    except Exception as e:
        print(f"[WARN] DB error in resolve_alert: {e}")
        return None


async def clear_alerts() -> dict:
    """Clear all geofence alerts from the database."""
    try:
        db = get_database()
        if db is None:
            return {"status": "cleared", "deleted_count": 0}
        result = await db["geofence_alerts"].delete_many({})
        return {"status": "cleared", "deleted_count": result.deleted_count}
    except Exception as e:
        print(f"[WARN] DB error in clear_alerts: {e}")
        return {"status": "error", "message": str(e), "deleted_count": 0}

