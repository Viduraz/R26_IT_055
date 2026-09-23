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


from app.ml_services.yolo_tracker import tracker_engine
from app.services.absence_monitor_service import evaluate_absence
from app.ml_services.inference.skeleton_tracker import SkeletonTracker


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


async def handle_identify_person(frame_data: str, person_id: str = None) -> dict:
    """
    Send frame to face-verification service for identity recognition.
    Uses POST /api/face/verify-caregiver which searches all enrolled caregivers.
    When verified, assigns identity to the tracker engine.
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
        display_name = caregiver_details.get("name", "Unknown Caregiver")
        confidence = result.get("confidence", 0.0)
        similarity = result.get("similarity", 0.0)
        role = caregiver_details.get("role", "caregiver")

        # Look up the user in local MongoDB for full profile info
        username = display_name
        try:
            db = get_database()
            if db is not None:
                user = await db["users"].find_one(
                    {"name": display_name}, {"_id": 0}
                )
                if user:
                    role = user.get("role", role)
                    username = user.get("username", display_name)
        except Exception as e:
            print(f"[WARN] User lookup failed: {e}")

        # Update tracker engine with this identity
        tracker_engine.set_person_identity(person_id or "", display_name, role, confidence)

        # Log the identification result to face_logs
        try:
            db = get_database()
            if db is not None:
                await db["face_logs"].insert_one({
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "match": True,
                    "identity": username,
                    "role": role,
                    "confidence": confidence,
                    "similarity": similarity,
                    "person_id": person_id,
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
            "similarity": similarity,
            "person_id": person_id,
        }

    except httpx.ConnectError:
        print("[WARN] Face-verification service unreachable")
        return {"matched": False, "error": "face-verification service unreachable"}
    except Exception as e:
        print(f"[ERROR] identify_person: {e}")
        return {"matched": False, "error": str(e)}


async def handle_start_caregiver_session(payload: dict) -> dict:
    """Start or accept a caregiver presence tracking session."""
    session_id = payload.get("session_id") or str(uuid.uuid4())
    caregiver_name = payload.get("caregiver_name") or payload.get("name") or "Unknown Caregiver"
    caregiver_id = payload.get("caregiver_id")
    now_str = datetime.now(timezone.utc).isoformat()

    session_data = {
        "session_id": session_id,
        "caregiver_id": caregiver_id,
        "caregiver_name": caregiver_name,
        "verified_at": payload.get("verified_at", now_str),
        "status": "verified_present",
        "last_seen_at": now_str,
    }

    try:
        db = get_database()
        if db is not None:
            await db["verified_caregiver_sessions"].update_one(
                {"session_id": session_id},
                {"$set": session_data},
                upsert=True,
            )
    except Exception as e:
        print(f"[WARN] Failed to persist caregiver session: {e}")

    return {
        "status": "ok",
        "session_id": session_id,
        "caregiver_name": caregiver_name,
        "message": f"Caregiver session {session_id} initialized",
    }


async def handle_update_caregiver_visibility(payload: dict) -> dict:
    """Update presence & skeleton visibility for a caregiver session."""
    session_id = payload.get("session_id")
    live_frame = payload.get("live_frame") or payload.get("frame")

    detection = {"present": False, "bbox": None, "confidence": None, "keypoints": None}
    if live_frame:
        try:
            detection = SkeletonTracker.detect_with_bbox(live_frame)
        except Exception as e:
            print(f"[WARN] SkeletonTracker error: {e}")

    try:
        evaluation = evaluate_absence(session_id, detection["present"])
    except Exception as e:
        evaluation = {"session_id": session_id, "status": "verified_present" if detection["present"] else "warning", "absence_seconds": 0}

    evaluation["bbox"] = detection.get("bbox")
    evaluation["confidence"] = detection.get("confidence")
    evaluation["keypoints"] = detection.get("keypoints")
    return evaluation


async def handle_get_exit_alerts() -> list:
    """Return recent zone exit alerts."""
    return await get_exit_alerts()


