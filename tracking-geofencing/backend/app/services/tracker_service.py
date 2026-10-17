"""
Tracking business logic service.
Uses the persistent PersonTrackerEngine for stable person IDs.
Integrates exit detection: checks for zone exits after each frame.
All DB operations are non-blocking and wrapped in try/except.
"""

import uuid
import time
import base64
import asyncio
from datetime import datetime, timezone
from app.database.db import get_database
from app.ml_services.yolo_tracker import tracker_engine
from app.services.geofence_service import (
    check_for_exits,
    update_person_zone_status,
    get_all_zones,
    person_exit_tracker,
)


async def _async_insert_log(log_doc: dict):
    """Background fire-and-forget DB logger to avoid holding up the frame response."""
    try:
        db = get_database()
        if db is not None:
            await db["tracking_logs"].insert_one(log_doc)
    except Exception as e:
        print(f"[WARN] Async tracking_logs save skipped: {e}")


async def process_frame(frame_data: str, elder_id: str = None, tracker_type: str = "bytetrack") -> dict:
    """Process a single video frame through the persistent tracker and geofence engine."""
    frame_id = str(uuid.uuid4())
    try:
        # Decode base64 frame if provided
        frame_bytes = None
        if frame_data:
            try:
                frame_bytes = base64.b64decode(frame_data)
                if len(frame_bytes) < 100:
                    frame_bytes = None
            except Exception as e:
                print(f"[SVC] ✗ Base64 decode failed: {e}")
                frame_bytes = None

        # Process through persistent tracker engine (now runs in ~80ms on CPU)
        tracked_persons = tracker_engine.process_frame(frame_bytes, tracker_type)
        now = datetime.now(timezone.utc).isoformat()

        # ── Exit detection pipeline ───────────────────────────────
        currently_tracked = [p["person_id"] for p in tracked_persons]
        exit_alerts = await check_for_exits(currently_tracked)

        # Update zone status for each visible person using cached zones (<0.05ms)
        try:
            zones = await get_all_zones()
            for person in tracked_persons:
                await update_person_zone_status(
                    person["person_id"],
                    person.get("identity", "Unknown"),
                    person["bbox"],
                    zones,
                )
                # Attach active zone name to person
                tracker_info = person_exit_tracker.get(person["person_id"])
                if tracker_info and tracker_info.get("last_zone"):
                    person["zone_status"] = tracker_info["last_zone"]
        except Exception as e:
            print(f"[WARN] Zone status update error: {e}")

        # Schedule DB persistence in background task — non-blocking
        if tracked_persons:
            asyncio.create_task(_async_insert_log({
                "frame_id": frame_id,
                "timestamp": now,
                "persons": tracked_persons,
                "person_count": len(tracked_persons),
                "elder_id": elder_id,
            }))

        metrics = tracker_engine.get_last_metrics()

        return {
            "frame_id": frame_id,
            "timestamp": now,
            "persons": tracked_persons,
            "person_count": len(tracked_persons),
            "exit_alerts": exit_alerts,
            "metrics": metrics,
        }
    except Exception as e:
        print(f"[ERROR] process_frame: {e}")
        return {
            "frame_id": frame_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "persons": [],
            "person_count": 0,
            "exit_alerts": [],
            "metrics": tracker_engine.get_last_metrics(),
            "error": str(e),
        }


async def get_tracking_history(page: int = 1, page_size: int = 50) -> dict:
    """Retrieve tracking log history with pagination."""
    try:
        db = get_database()
        if db is None:
            return {"logs": [], "total": 0, "page": page, "page_size": page_size}

        collection = db["tracking_logs"]
        skip = (page - 1) * page_size
        total = await collection.count_documents({})
        cursor = collection.find({}, {"_id": 0}).sort("timestamp", -1).skip(skip).limit(page_size)
        logs = await cursor.to_list(length=page_size)

        return {"logs": logs, "total": total, "page": page, "page_size": page_size}
    except Exception as e:
        print(f"[WARN] DB error in get_tracking_history: {e}")
        return {"logs": [], "total": 0, "page": page, "page_size": page_size}


async def get_active_persons() -> dict:
    """Return confirmed-active persons (seen within ACTIVE_TIMEOUT) from the engine."""
    try:
        active_ids = tracker_engine.get_active_ids()
        active_persons = tracker_engine.get_confirmed_active_persons()
        return {
            "active_ids": active_ids,
            "active_count": tracker_engine.get_confirmed_active_count(),
            "persons": active_persons,
            "metrics": tracker_engine.get_last_metrics(),
        }
    except Exception as e:
        print(f"[WARN] get_active_persons error: {e}")
        return {"active_ids": [], "active_count": 0, "persons": []}


async def get_tracking_stats() -> dict:
    """Aggregate tracking statistics for today."""
    try:
        active_now = tracker_engine.get_confirmed_active_count()
        active_persons = tracker_engine.get_confirmed_active_persons()

        total_today = 0
        alerts_today = 0
        zones_count = 0

        try:
            db = get_database()
            if db is not None:
                today_start = datetime.now(timezone.utc).replace(
                    hour=0, minute=0, second=0, microsecond=0).isoformat()
                total_today = await db["tracking_logs"].count_documents(
                    {"timestamp": {"$gte": today_start}})
                alerts_today = await db["geofence_alerts"].count_documents(
                    {"timestamp": {"$gte": today_start}})
                zones_count = await db["geofence_zones"].count_documents(
                    {"is_active": True})
        except Exception as e:
            print(f"[WARN] DB error in get_tracking_stats: {e}")

        return {
            "total_tracked_today": total_today,
            "active_now": active_now,
            "active_persons": active_persons,
            "alerts_today": alerts_today,
            "zones_configured": zones_count,
            "total_unique_persons": tracker_engine.next_id - 1,
            "metrics": tracker_engine.get_last_metrics(),
        }
    except Exception as e:
        print(f"[ERROR] get_tracking_stats: {e}")
        return {
            "total_tracked_today": 0,
            "active_now": 0,
            "alerts_today": 0,
            "zones_configured": 0,
            "total_unique_persons": 0,
        }
