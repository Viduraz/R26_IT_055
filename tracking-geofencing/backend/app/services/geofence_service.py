"""
Geofence business logic service.
Handles zone CRUD, breach detection using Shapely, smart exit detection,
and alert management with server-side debouncing and in-memory zone caching.
All DB operations wrapped in try/except to survive MongoDB disconnection.
"""

import uuid
import time
from datetime import datetime, timezone
from typing import List, Tuple, Optional
from shapely.geometry import Point, Polygon
from app.database.db import get_database


# ── In-Memory Zone Cache (eliminates 80-100ms DB roundtrip per frame) ──
_zones_cache: Optional[List[dict]] = None
_zones_cache_timestamp: float = 0.0
_ZONES_CACHE_TTL: float = 10.0  # seconds


def invalidate_zones_cache():
    global _zones_cache, _zones_cache_timestamp
    _zones_cache = None
    _zones_cache_timestamp = 0.0


# ── Alert Debounce Tracker (prevents alert storms on consecutive frames) ──
# (person_id, zone_id, alert_type) -> float timestamp
_alert_debounce_tracker: dict = {}
ALERT_DEBOUNCE_COOLDOWN: float = 15.0  # 15 seconds cooldown for duplicate alerts


def is_alert_debounced(person_id: str, zone_id: str, alert_type: str = "entry") -> bool:
    """Return True if an identical alert was fired recently and should be throttled."""
    now = time.time()
    key = (person_id, zone_id, alert_type)
    last_time = _alert_debounce_tracker.get(key, 0.0)
    if (now - last_time) < ALERT_DEBOUNCE_COOLDOWN:
        return True
    _alert_debounce_tracker[key] = now
    return False


# ── Person Exit Tracker (in-memory singleton) ─────────────────────
# { person_id: { "last_zone": str|None, "last_zone_id": str|None, "last_seen": float,
#                "identity": str, "exit_alerted": bool,
#                "max_area_in_zone": float, "last_area": float } }
person_exit_tracker: dict = {}


def _normalize_point_and_polygon(point: tuple, polygon: list, frame_w: float = None, frame_h: float = None) -> Tuple[tuple, list]:
    """
    Ensure point and polygon coordinates share the same coordinate space.
    Handles seamless interoperability between normalized (0-1) and pixel coordinates.
    """
    if len(polygon) < 3:
        return point, polygon

    poly_max_x = max(p[0] for p in polygon)
    poly_max_y = max(p[1] for p in polygon)
    is_poly_normalized = poly_max_x <= 1.05 and poly_max_y <= 1.05

    pt_x, pt_y = point
    is_pt_normalized = pt_x <= 1.05 and pt_y <= 1.05

    # Case 1: Polygon normalized (0-1), point in pixel coordinates -> scale poly to pixels
    if is_poly_normalized and not is_pt_normalized:
        w = frame_w or max(pt_x, 640.0)
        h = frame_h or max(pt_y, 480.0)
        scaled_poly = [[p[0] * w, p[1] * h] for p in polygon]
        return point, scaled_poly

    # Case 2: Point normalized (0-1), polygon in pixel coordinates -> scale point to pixels
    if not is_poly_normalized and is_pt_normalized:
        w = frame_w or poly_max_x
        h = frame_h or poly_max_y
        scaled_point = (pt_x * w, pt_y * h)
        return scaled_point, polygon

    return point, polygon


def _point_in_polygon(centroid: tuple, polygon: list, frame_w: float = None, frame_h: float = None) -> bool:
    """Check if point (x, y) is inside polygon [[x,y], ...], auto-aligning coordinate spaces."""
    if len(polygon) < 3:
        return False
    try:
        pt, poly = _normalize_point_and_polygon(centroid, polygon, frame_w, frame_h)
        return Polygon(poly).contains(Point(pt))
    except Exception:
        return False


async def update_person_zone_status(
    person_id: str,
    identity: str,
    bbox: dict,
    zones: list,
):
    """Called every frame for each detected person to track zone occupancy, entry, and exits."""
    now = time.time()

    # Bottom-center of the person's bounding box is the ground contact reference point (feet)
    feet = (bbox["x"] + bbox["w"] / 2.0, bbox["y"] + bbox["h"])
    area = bbox["w"] * bbox["h"]
    frame_w = bbox.get("frame_w")
    frame_h = bbox.get("frame_h")

    # Depth & posture estimation
    person_w = bbox.get("w", 0)
    person_h = bbox.get("h", 100)
    aspect_ratio = (person_w / person_h) if person_h > 0 else 0.0
    is_sitting = aspect_ratio >= 0.58

    effective_h = max(person_h, person_w / 0.45) if is_sitting else person_h
    distance_meters = 850.0 / effective_h if effective_h > 0 else 0.0

    current_zone = None
    current_zone_id = None
    current_zone_type = None

    for zone in zones:
        if not zone.get("is_active"):
            continue

        poly = zone.get("polygon", [])
        if len(poly) >= 3 and _point_in_polygon(feet, poly, frame_w, frame_h):
            current_zone = zone.get("name")
            current_zone_id = zone.get("zone_id")
            current_zone_type = zone.get("zone_type")
            break

    # Update or initialize person exit & zone history
    if person_id not in person_exit_tracker:
        person_exit_tracker[person_id] = {
            "last_zone": current_zone,
            "last_zone_id": current_zone_id,
            "last_zone_type": current_zone_type,
            "last_seen": now,
            "identity": identity,
            "exit_alerted": False,
            "max_area_in_zone": area if current_zone else 0,
            "last_area": area,
        }
    else:
        tracker = person_exit_tracker[person_id]
        previous_zone = tracker.get("last_zone")
        previous_zone_id = tracker.get("last_zone_id")
        previous_zone_type = tracker.get("last_zone_type")

        # Depth-aware exit detection: person stepped out of zone and is moving away
        if previous_zone and not current_zone and not tracker.get("exit_alerted"):
            if area < tracker.get("max_area_in_zone", 0) * 0.85:
                tracker["exit_alerted"] = True
                await _trigger_exit_alert(person_id, tracker.get("identity", "Unknown"), previous_zone, previous_zone_id)

        # Permitted/Safe zone exit alert: person was inside a safe zone and stepped outside
        if previous_zone_type == "safe" and current_zone_type != "safe":
            if not is_alert_debounced(person_id, previous_zone_id or "safe_zone", "safe_exit"):
                await _trigger_safe_zone_exit_alert(person_id, identity, previous_zone)

        # Update state
        tracker["last_seen"] = now
        tracker["identity"] = identity
        tracker["last_area"] = area

        if current_zone:
            tracker["last_zone"] = current_zone
            tracker["last_zone_id"] = current_zone_id
            tracker["last_zone_type"] = current_zone_type
            tracker["max_area_in_zone"] = max(tracker.get("max_area_in_zone", 0), area)
            tracker["exit_alerted"] = False
        else:
            tracker["max_area_in_zone"] = tracker.get("max_area_in_zone", 0) * 0.99


async def _trigger_exit_alert(person_id: str, identity: str, zone_name: str, zone_id: str = None) -> dict:
    """Helper to create and save an exit alert with debouncing."""
    if is_alert_debounced(person_id, zone_id or zone_name, "exit"):
        return {}

    alert = {
        "alert_id": str(uuid.uuid4()),
        "alert_type": "zone_exit",
        "person_id": person_id,
        "identity": identity,
        "last_zone": zone_name,
        "zone_name": zone_name,
        "zone_id": zone_id,
        "breach_type": "exit",
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "message": f"{identity if identity != 'Unknown' else person_id} has left the {zone_name} area",
        "resolved": False,
        "severity": "high",
    }
    try:
        db = get_database()
        if db is not None:  # Fixed: avoid 'if db' which raises NotImplementedError in Motor
            await db["geofence_alerts"].insert_one(alert.copy())
    except Exception as e:
        print(f"[WARN] Alert save error: {e}")
    return alert


async def _trigger_safe_zone_exit_alert(person_id: str, identity: str, safe_zone_name: str) -> dict:
    """Helper to create an alert when an elderly person leaves a permitted/safe zone."""
    alert = {
        "alert_id": str(uuid.uuid4()),
        "alert_type": "safe_zone_exit",
        "person_id": person_id,
        "identity": identity,
        "last_zone": safe_zone_name,
        "zone_name": safe_zone_name,
        "breach_type": "left_safe_area",
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "message": f"Alert: {identity if identity != 'Unknown' else person_id} has left the safe zone ({safe_zone_name})",
        "resolved": False,
        "severity": "medium",
    }
    try:
        db = get_database()
        if db is not None:
            await db["geofence_alerts"].insert_one(alert.copy())
    except Exception as e:
        print(f"[WARN] Safe zone exit alert save error: {e}")
    return alert


async def check_for_exits(currently_tracked_ids: list) -> list:
    """
    Called every frame with list of person IDs currently visible.
    Persons in tracker who disappear while in a zone trigger an exit alert.
    """
    now = time.time()
    exit_alerts = []

    for person_id, data in list(person_exit_tracker.items()):
        if person_id in currently_tracked_ids:
            continue

        time_since_seen = now - data.get("last_seen", 0)

        # Person disappeared 1-5 seconds ago
        if 1.0 < time_since_seen < 5.0 and not data.get("exit_alerted"):
            last_zone = data.get("last_zone")
            last_zone_id = data.get("last_zone_id")

            if last_zone and data.get("last_area", 0) < data.get("max_area_in_zone", 0) * 0.9:
                person_exit_tracker[person_id]["exit_alerted"] = True
                alert = await _trigger_exit_alert(person_id, data.get("identity", "Unknown"), last_zone, last_zone_id)
                if alert:
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


# ── Zone CRUD with In-Memory Caching ──────────────────────────────

async def create_zone(name: str, zone_type: str, polygon: list, color: str = "#00D4FF", camera_distance: float = 4.0) -> dict:
    """Create a new geofence zone and invalidate cache."""
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
        invalidate_zones_cache()
        return zone
    except Exception as e:
        print(f"[WARN] DB error in create_zone: {e}")
        zone.pop("_id", None)
        invalidate_zones_cache()
        return zone


async def get_all_zones(force_refresh: bool = False) -> list:
    """Retrieve all geofence zones with in-memory caching."""
    global _zones_cache, _zones_cache_timestamp
    now = time.time()

    if not force_refresh and _zones_cache is not None and (now - _zones_cache_timestamp) < _ZONES_CACHE_TTL:
        return _zones_cache

    try:
        db = get_database()
        if db is None:
            return _zones_cache or []
        cursor = db["geofence_zones"].find({}, {"_id": 0})
        zones = await cursor.to_list(length=200)
        _zones_cache = zones
        _zones_cache_timestamp = now
        return zones
    except Exception as e:
        print(f"[WARN] DB error in get_all_zones: {e}")
        return _zones_cache or []


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
    """Update an existing zone and invalidate cache."""
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
        invalidate_zones_cache()
        if result.matched_count == 0:
            return None
        return await get_zone(zone_id)
    except Exception as e:
        print(f"[WARN] DB error in update_zone: {e}")
        invalidate_zones_cache()
        return None


async def delete_zone(zone_id: str) -> bool:
    """Delete a zone by its zone_id and invalidate cache."""
    try:
        db = get_database()
        if db is None:
            return False
        result = await db["geofence_zones"].delete_one({"zone_id": zone_id})
        invalidate_zones_cache()
        return result.deleted_count > 0
    except Exception as e:
        print(f"[WARN] DB error in delete_zone: {e}")
        invalidate_zones_cache()
        return False


# ── Breach Checking with Debouncing & Coordinate Invariance ──────

async def check_breach(person_id: str, x: float, y: float, frame_w: float = None, frame_h: float = None) -> dict:
    """
    Check if a person's foot contact position (x, y) breaches any active geofence zone.
    Applies server-side debouncing to avoid redundant alerts.
    """
    try:
        db = get_database()
        zones = await get_all_zones()
        if not zones:
            return {"person_id": person_id, "breaches": [], "is_breached": False}

        # Look up tracked person for height and posture
        from app.ml_services.yolo_tracker import tracker_engine
        person_info = tracker_engine.bytetrack_tracked.get(person_id) or tracker_engine.deepsort_tracked.get(person_id)

        person_w = person_info.bbox.get("w", 0) if (person_info and person_info.bbox) else 0
        person_h = person_info.bbox.get("h", 100) if (person_info and person_info.bbox) else 100
        aspect_ratio = (person_w / person_h) if person_h > 0 else 0.0
        is_sitting = getattr(person_info, "is_sitting", aspect_ratio >= 0.58) if person_info else (aspect_ratio >= 0.58)

        effective_h = max(person_h, person_w / 0.45) if is_sitting else person_h
        distance_meters = 850.0 / effective_h if effective_h > 0 else 0.0

        breaches = []
        raw_point = (x, y)

        for zone in zones:
            if not zone.get("is_active"):
                continue

            poly_coords = zone.get("polygon", [])
            if len(poly_coords) < 3:
                continue

            pt, poly = _normalize_point_and_polygon(raw_point, poly_coords, frame_w, frame_h)
            polygon = Polygon(poly)
            point = Point(pt)

            if polygon.contains(point):
                if zone["zone_type"] == "safe":
                    # Currently inside safe zone — normal
                    continue

                # Restricted zone entry breach
                zone_id = zone.get("zone_id", "unknown")
                if is_alert_debounced(person_id, zone_id, "entry"):
                    # Debounced: acknowledge breach state without inserting duplicate DB alert
                    breaches.append({
                        "alert_id": f"debounced-{zone_id}",
                        "person_id": person_id,
                        "zone_id": zone_id,
                        "zone_name": zone["name"],
                        "breach_type": "entry",
                        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                        "resolved": False,
                        "debounced": True,
                    })
                    continue

                alert = {
                    "alert_id": str(uuid.uuid4()),
                    "person_id": person_id,
                    "zone_id": zone_id,
                    "zone_name": zone["name"],
                    "breach_type": "entry",
                    "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                    "resolved": False,
                }
                if db is not None:
                    try:
                        await db["geofence_alerts"].insert_one(alert.copy())
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
        print(f"[WARN] check_breach error: {e}")
        return {"person_id": person_id, "breaches": [], "is_breached": False}


async def get_alerts(resolved: bool = None, since: str = None) -> list:
    """Retrieve geofence alerts with optional resolved status and timestamp filters."""
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
