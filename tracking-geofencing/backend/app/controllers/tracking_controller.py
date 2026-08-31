"""
Tracking controller — thin layer between routes and services.
"""

import uuid
import httpx
from datetime import datetime, timezone
from app.services.tracker_service import (
    process_frame,
    get_tracking_history,
    get_active_persons,
    get_tracking_stats,
)
from app.services.geofence_service import get_exit_alerts
from app.database.db import get_database
from app.models.tracking_models import ProcessFrameRequest


FACE_VERIFICATION_URL = "http://localhost:8001"


async def handle_process_frame(request: ProcessFrameRequest) -> dict:
    """Process a video frame and return detections."""
    return await process_frame(request.frame, request.elder_id, request.tracker_type)


async def handle_get_history(page: int = 1, page_size: int = 50) -> dict:
    """Get tracking history with pagination."""
    return await get_tracking_history(page, page_size)


async def handle_get_active() -> dict:
    """Get currently active (detected) persons."""
    return await get_active_persons()


async def handle_get_stats() -> dict:
    """Get tracking statistics for today."""
    return await get_tracking_stats()


async def handle_identify_person(frame_data: str) -> dict:
    """
    Send frame to face-verification service for identity recognition.
    Uses POST /api/face/verify-caregiver which searches all enrolled caregivers.
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Call face-verification service
            resp = await client.post(
                f"{FACE_VERIFICATION_URL}/api/face/verify-caregiver",
                json={"live_sample": frame_data},
            )

            if resp.status_code != 200:
                # Face detection may fail (no face in frame) — not an error
                return {"matched": False}

            result = resp.json()

        verified = result.get("verified", False)
        if not verified:
            return {"matched": False}

        # Extract identity info from the response
        caregiver_details = result.get("caregiver_details", {})
        display_name = caregiver_details.get("name", "Unknown")
        confidence = result.get("confidence", 0.0)
        similarity = result.get("similarity", 0.0)

        # Look up the user in our local MongoDB for role info
        role = "unknown"
        username = display_name
        try:
            db = get_database()
            if db:
                user = await db["users"].find_one(
                    {"name": display_name}, {"_id": 0}
                )
                if user:
                    role = user.get("role", "unknown")
                    username = user.get("username", display_name)
        except Exception as e:
            print(f"[WARN] User lookup failed: {e}")

        # Log the identification result to face_logs
        try:
            db = get_database()
            if db:
                await db["face_logs"].insert_one({
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "match": True,
                    "identity": username,
                    "confidence": confidence,
                    "similarity": similarity,
                    "frame_reference": str(uuid.uuid4()),
                    "source": "tracking-geofencing",
                })
        except Exception as e:
            print(f"[WARN] face_logs save failed: {e}")

        return {
            "matched": True,
            "identity": display_name,
            "role": role,
            "username": username,
            "confidence": confidence,
        }

    except httpx.ConnectError:
        print("[WARN] Face-verification service unreachable")
        return {"matched": False, "error": "face-verification service unreachable"}
    except Exception as e:
        print(f"[ERROR] identify_person: {e}")
        return {"matched": False, "error": str(e)}


async def handle_get_exit_alerts() -> list:
    """Return recent zone exit alerts."""
    return await get_exit_alerts()

