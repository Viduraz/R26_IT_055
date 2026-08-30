"""
gateway/routes/stream.py
WebSocket endpoint for real-time video streaming pipeline.

Flow:
  Client sends base64 JPEG frame via WebSocket
    -> Video Processing (preprocess)
    -> Pose Estimation (keypoints)
    -> Feature Extraction (static + gait)
    -> Identification (ensemble predict)
    -> Send result JSON back to client
"""
import asyncio
import base64
import json
import math
import time
import cv2
import httpx
import numpy as np
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List, Optional

import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from config import settings
from database.crud import FeatureProfileCRUD, IdentificationLogCRUD, UserCRUD
from database.schemas import IdentificationLog
from services.feature_extraction.gait_features import GaitFeatureExtractor
from services.feature_extraction.static_features import StaticFeatureExtractor
from services.identification.predictor import Predictor
from services.pose_estimation.estimator import PoseEstimator
from services.video_processing.processor import VideoProcessor

log = structlog.get_logger()

router = APIRouter(tags=["WebSocket Stream"])
DISPLAY_CONFIDENCE_THRESHOLD = 0.70
MULTI_PERSON_MAX_POSES = 8  # cap on how many people the multi-person overlay tracks per frame
MULTI_PERSON_TIMEOUT_S = 3.0  # guard against a hung/slow native inference call freezing the connection
FACE_VERIFY_URL = "http://localhost:8001/api/face/verify-caregiver"
FACE_VERIFY_TIMEOUT_S = 4.0  # bounded face verification timeout

# Multi-person identity tracking configuration
TRACK_MATCH_DISTANCE = 0.35          # max normalized bbox-center movement between frames to count as "same person"
TRACK_POSITION_SMOOTHING_ALPHA = 0.5  # EMA on a track's reference position
TRACK_EXPIRE_S = 4.5                 # drop a track if unmatched for 4.5 seconds
CONFIDENCE_SMOOTHING_ALPHA = 0.35    # EMA applied to confidence number

# A brand-new track commits to whatever its very first frame says, with no
# confirmation — that's what keeps a genuinely new person's box/name feeling
# immediate. But it also means a single bad-angle/motion-blur misread of an
# actually-known person, right as they walk in, would otherwise look exactly
# like a real unknown person from frame one. Rather than slow down the live
# display for everyone, each track separately reports how long it's been
# continuously unknown (unknown_ms) — the frontend only fires a security
# alert once that's been true for a few real seconds, which is enough for a
# one-off misread to self-correct without meaningfully delaying a real one.


# Shared thread pool for CPU-bound tasks (MediaPipe, LSTM) — used by the primary
# single-person pipeline (signup, login, enrollment, single-person identify).
_cpu_executor = ThreadPoolExecutor(max_workers=2)

# Separate pool for the multi-person overlay only. A ThreadPoolExecutor thread that
# times out via asyncio.wait_for is NOT actually cancelled — it keeps running the
# blocking call in the background, permanently occupying that worker if the call
# never returns. Isolating multi-person detection here means a wedged worker can
# only ever starve itself, never the primary pipeline above that signup/login/
# enrollment depend on.
_multi_person_executor = ThreadPoolExecutor(max_workers=2)


def _compute_bbox(keypoints: List[Dict], min_visibility: float = 0.02, padding: float = 0.06) -> Optional[List[float]]:
    """Normalized (0..1) [x1, y1, x2, y2] bounding box around a person's visible
    keypoints, padded outward so the box comfortably encloses their silhouette
    including seated and chest-up webcam views."""
    xs = [kp["x"] for kp in keypoints if kp.get("visibility", 0.0) > min_visibility]
    ys = [kp["y"] for kp in keypoints if kp.get("visibility", 0.0) > min_visibility]
    if len(xs) < 2:
        return None

    x1, x2 = min(xs), max(xs)
    y1, y2 = min(ys), max(ys)
    pad_x = (x2 - x1) * padding + 0.02
    pad_y = (y2 - y1) * padding + 0.03

    return [
        max(0.0, x1 - pad_x),
        max(0.0, y1 - pad_y),
        min(1.0, x2 + pad_x),
        min(1.0, y2 + pad_y),
    ]


# Head landmark indices (0-10 of the 33-point MediaPipe Pose model): nose, eyes,
# ears, mouth — see estimator.py's LANDMARK_NAMES.
_HEAD_LANDMARK_COUNT = 11


def _face_crop_bbox(keypoints: List[Dict], min_visibility: float = 0.05) -> Optional[List[float]]:
    """Normalized (0..1) [x1, y1, x2, y2] region around a person's head, padded
    very generously — MTCNN (used by the face-verification service) needs the
    whole face plus ample margin to find all five landmarks, so a tight crop
    right at the skin edge tends to fail detection entirely.

    Padding increased from earlier conservative values to maximize face-detection
    hit rate in multi-person scenarios where people may be partially turned."""
    head_kps = keypoints[:_HEAD_LANDMARK_COUNT]
    xs = [kp["x"] for kp in head_kps if kp["visibility"] > min_visibility]
    ys = [kp["y"] for kp in head_kps if kp["visibility"] > min_visibility]
    if len(xs) < 2:  # lowered from 3 — nose + one eye is enough
        return None

    x1, x2 = min(xs), max(xs)
    y1, y2 = min(ys), max(ys)
    w = max(x2 - x1, 0.06)
    h = max(y2 - y1, 0.06)

    return [
        max(0.0, x1 - w * 0.35),  # Tightened padding to prevent capturing neighboring faces
        max(0.0, y1 - h * 0.45),
        min(1.0, x2 + w * 0.35),
        min(1.0, y2 + h * 0.55),
    ]


def _encode_face_crop(frame_bgr: np.ndarray, keypoints: List[Dict], min_side_px: int = 40) -> Optional[str]:
    """Crop a person's head region out of the raw frame and JPEG-encode it as
    base64, ready to send to the face-verification service. None if no usable
    crop can be derived (head not visible, or the resulting region is too
    small to plausibly contain a recognizable face).

    Falls back to the upper portion of the person's body bounding box if
    head-landmark-based cropping fails (e.g. person is partially turned)."""
    bbox = _face_crop_bbox(keypoints)

    # Fallback: if head landmarks aren't visible enough for a landmark-based
    # crop, use the upper 45% of the full person bounding box — this is
    # where the head/face region is likely to be.
    if bbox is None:
        full_bbox = _compute_bbox(keypoints, min_visibility=0.05, padding=0.08)
        if full_bbox is not None:
            fx1, fy1, fx2, fy2 = full_bbox
            face_height = (fy2 - fy1) * 0.45
            bbox = [fx1, fy1, fx2, fy1 + face_height]

    if bbox is None:
        return None

    h_img, w_img = frame_bgr.shape[:2]
    x1, y1, x2, y2 = bbox
    px1, py1 = int(x1 * w_img), int(y1 * h_img)
    px2, py2 = int(x2 * w_img), int(y2 * h_img)

    if px2 - px1 < min_side_px or py2 - py1 < min_side_px:
        return None

    crop = frame_bgr[py1:py2, px1:px2]
    if crop.size == 0:
        return None

    ok, buf = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not ok:
        return None
    return base64.b64encode(buf).decode("utf-8")


class StreamPipeline:
    """Per-connection pipeline instances."""

    def __init__(self, predictor: Predictor):
        self.processor = VideoProcessor()
        self.pose = PoseEstimator(
            model_complexity=settings.mediapipe_model_complexity,
            min_detection_confidence=settings.min_detection_confidence,
            min_tracking_confidence=settings.min_tracking_confidence,
        )
        # Lazily created only for connections that actually request multi-person
        # detection (LiveFeedPage's detect_mode="multi") — a separate landmarker
        # instance so the primary single-person pipeline above (used by signup,
        # login, and enrollment) is never touched by this.
        self.pose_multi: Optional[PoseEstimator] = None
        self.static_ext = StaticFeatureExtractor()
        self.gait_ext = GaitFeatureExtractor(
            window_size=settings.lstm_sequence_length,
            fps=30.0,
        )
        self.predictor = predictor
        self.prev_features: Optional[Dict] = None
        self.frame_count = 0
        self.user_name_map: Dict[str, str] = {}
        self.user_role_map: Dict[str, str] = {}
        self._last_user_cache_refresh = 0.0
        self._last_knn_refresh = 0.0
        # Multi-person identity tracking: frame-to-frame association by bbox
        # proximity, so a person keeps their identified name/role as they move
        # around instead of it flickering per-frame. See _stabilize_tracks().
        self.single_track = {
            "first_seen": None,
            "last_seen": None,
            "state": "unknown",
            "observations": [],
            "committed_name": "Unknown Person",
            "committed_role": "Visitor / Unregistered",
            "committed_is_known": False,
            "committed_confidence": 0.0,
            "committed_method": "none",
            "unknown_since": None,
        }
        self.tracks: List[Dict] = []
        self._next_track_id = 0
        # Performance: run prediction every frame for immediate real-time response
        self._identify_every_n = 1
        self._last_identification: Dict = {
            "predicted_user": "unknown",
            "confidence": 0.0,
            "is_known": False,
            "method": "none",
            "top_k": [],
        }
        # DB write throttle — log at most once every 2 seconds
        self._last_db_log_time = 0.0
        self.face_samples = []
        self._last_face_conf = 0.0
        self._last_skeleton_conf = 0.0

    async def _refresh_user_name_map(self):
        """Refresh user id -> name/role cache periodically to avoid per-frame DB reads."""
        now = time.time()
        if self.user_name_map and (now - self._last_user_cache_refresh < 5):
            return

        users = await UserCRUD.list_all()
        self.user_name_map = {u["user_id"]: u["name"] for u in users}
        self.user_role_map = {u["user_id"]: (u.get("role") or "caregiver") for u in users}
        self._last_user_cache_refresh = now

    async def _refresh_knn_templates(self):
        """Reload KNN templates from the database periodically.
        This is needed so the KNN template matcher stays in sync with
        enrollment changes without restarting the server."""
        now = time.time()
        if self.predictor.knn_ready and (now - self._last_knn_refresh < 10):
            return
        try:
            profiles = await FeatureProfileCRUD.get_all_profiles()
            if profiles:
                self.predictor.load_knn_templates(profiles)
        except Exception as exc:
            log.warning("knn_template_refresh_failed", error=str(exc))
        self._last_knn_refresh = now

    def _update_single_track(self, raw_user_id: str, confidence: float, is_known_for_display: bool, method: str):
        """Immediate real-time identification for single-person identification."""
        now = time.time()

        # Reset if stream was interrupted / no person seen for > 1.0s
        if self.single_track["first_seen"] is None or (self.single_track["last_seen"] and (now - self.single_track["last_seen"] > 1.0)):
            self.single_track["session_id"] = int(now * 1000)
            self.single_track["first_seen"] = now
            self.single_track["last_seen"] = now
            self.single_track["unknown_since"] = None
        else:
            self.single_track["last_seen"] = now

        cand_name = self.user_name_map.get(raw_user_id) if (raw_user_id != "unknown" and is_known_for_display) else "Unknown Person"
        cand_role = self.user_role_map.get(raw_user_id, "caregiver") if (raw_user_id != "unknown" and is_known_for_display) else "Visitor / Unregistered"

        is_known = is_known_for_display and cand_name != "Unknown Person"

        self.single_track["state"] = "identified" if is_known else "unknown"
        self.single_track["committed_name"] = cand_name
        self.single_track["committed_role"] = cand_role
        self.single_track["committed_is_known"] = is_known
        self.single_track["committed_confidence"] = round(confidence, 4)
        self.single_track["committed_method"] = method

        if is_known:
            self.single_track["unknown_since"] = None
        elif not self.single_track["unknown_since"]:
            self.single_track["unknown_since"] = now

    async def process_frame(
        self,
        frame_b64: str,
        mode: str = "identify",
        user_id: Optional[str] = None,
        enroll_type: str = "skeleton",
    ) -> Dict:
        """Full pipeline for one frame."""
        t_start = time.perf_counter()
        self.frame_count += 1

        frame_bgr = VideoProcessor.base64_to_frame(frame_b64)
        if frame_bgr is None:
            return {
                "detected": False,
                "body_visible": False,
                "features_ok": False,
                "frame": self.frame_count,
                "mode": mode,
                "status_msg": "Invalid frame received",
                "latency_ms": round((time.perf_counter() - t_start) * 1000, 2),
            }

        rgb = self.processor.preprocess_frame(frame_bgr)
        # Run MediaPipe in thread pool — avoids blocking the async event loop
        loop = asyncio.get_event_loop()
        all_kps = await loop.run_in_executor(_cpu_executor, self.pose.estimate, rgb)

        if all_kps is None:
            now = time.time()
            if self.single_track.get("last_seen") and (now - self.single_track["last_seen"] > 1.0):
                self.single_track["first_seen"] = None
                self.single_track["state"] = "unknown"
                self.single_track["committed_name"] = "Unknown Person"
                self.single_track["committed_role"] = "Visitor / Unregistered"
                self.single_track["committed_is_known"] = False
                self.prev_features = None
                self.gait_ext.reset()
            return {
                "detected": False,
                "body_visible": False,
                "features_ok": False,
                "frame": self.frame_count,
                "mode": mode,
                "status_msg": "No person detected",
                "latency_ms": round((time.perf_counter() - t_start) * 1000, 2),
            }

        keypoints = [
            {"x": kp["x"], "y": kp["y"], "visibility": kp["visibility"]}
            for kp in all_kps
        ]

        body_kps = self.pose.get_body_keypoints(all_kps)
        if body_kps is None:
            return {
                "detected": True,
                "body_visible": False,
                "features_ok": False,
                "frame": self.frame_count,
                "mode": mode,
                "keypoints": keypoints,
                "status_msg": "Please step back until the full body is visible",
                "latency_ms": round((time.perf_counter() - t_start) * 1000, 2),
            }

        raw_features = self.static_ext.extract_all(body_kps)
        if raw_features is None:
            return {
                "detected": True,
                "body_visible": True,
                "features_ok": False,
                "frame": self.frame_count,
                "mode": mode,
                "keypoints": keypoints,
                "status_msg": "Detection too noisy, hold still",
                "latency_ms": round((time.perf_counter() - t_start) * 1000, 2),
            }

        static_vector = self.static_ext.to_vector(raw_features)

        angles = self.static_ext.compute_joint_angles(body_kps)
        self.gait_ext.add_frame(body_kps, angles)
        gait_ready = self.gait_ext.is_ready()
        gait_sequence = self.gait_ext.get_sequence_matrix() if gait_ready else None

        # Only run identification every N frames to reduce latency
        # Skip identification entirely during enrollment — not needed and saves ~50ms
        should_identify = (
            mode != "enroll" and self.frame_count % self._identify_every_n == 0
        )

        await self._refresh_user_name_map()
        await self._refresh_knn_templates()

        if should_identify:
            # Run ML inference in thread pool — avoids blocking the async event loop
            loop = asyncio.get_event_loop()
            identification = await loop.run_in_executor(
                _cpu_executor,
                lambda: self.predictor.identify(
                    static_features=static_vector,
                    gait_sequence=gait_sequence,
                )
            )
            self._last_skeleton_conf = float(identification.get("confidence", 0.0))
            self._last_identification = identification
        else:
            identification = self._last_identification

        await self._refresh_user_name_map()
        await self._refresh_knn_templates()

        raw_user_id = identification.get("predicted_user", "unknown")
        confidence = float(identification.get("confidence", 0.0))
        is_model_known = bool(identification.get("is_known", False))
        predicted_name = self.user_name_map.get(raw_user_id) if raw_user_id != "unknown" else None

        conf_threshold = getattr(settings, "confidence_threshold", 0.72)
        is_known_for_display = (
            is_model_known
            and raw_user_id != "unknown"
            and predicted_name is not None
            and confidence >= conf_threshold
        )
        display_user = predicted_name if is_known_for_display else "unknown"

        top_candidates = []
        for c in identification.get("top_k", [])[:3]:
            uid = c.get("user_id", "")
            cand_name = self.user_name_map.get(uid, "Unknown")
            top_candidates.append(
                {
                    **c,
                    "user": cand_name,
                }
            )

        result_extra: Dict[str, object] = {}
        if mode == "enroll" and user_id:
            if enroll_type == "face":
                self.face_samples.append(frame_b64)
                count = len(self.face_samples)
                status = "in_progress"
                target_frames = 30
                
                if count >= target_frames:
                    # Fire-and-forget the face enrollment to face-verification API
                    async def do_face_enroll(uid, samples):
                        try:
                            async with httpx.AsyncClient(timeout=10.0) as client:
                                resp = await client.post(
                                    "http://localhost:8001/api/face/enroll",
                                    json={"samples": samples}
                                )
                                if resp.status_code == 200:
                                    emb = resp.json().get("embedding")
                                    if emb:
                                        from database.connection import MongoDB
                                        await MongoDB.get_collection("users").update_one(
                                            {"user_id": uid},
                                            {"$set": {
                                                "face_embeddings": emb,
                                                "face_verification_status": "enrolled"
                                            }}
                                        )
                        except Exception as e:
                            log.error("face_enroll_failed", error=str(e))
                            
                    asyncio.create_task(do_face_enroll(user_id, list(self.face_samples)))
                    status = "completed"
                    
                result_extra = {
                    "frames_collected": count,
                    "enrollment_status": status,
                    "progress": min(count / target_frames * 100, 100),
                }
            else:
                try:
                    await FeatureProfileCRUD.upsert(
                        user_id=user_id,
                        static_vector=static_vector.tolist(),
                        gait_sequence=gait_sequence.tolist() if gait_sequence is not None else None,
                    )
    
                    profile = await FeatureProfileCRUD.get_by_user(user_id)
                    count = profile["sample_count"] if profile else 0
                    status = "completed" if count >= settings.min_enrollment_frames else "in_progress"
                    await UserCRUD.update_enrollment_status(user_id, status, count)
    
                    result_extra = {
                        "frames_collected": count,
                        "enrollment_status": status,
                        "progress": min(count / settings.min_enrollment_frames * 100, 100),
                    }
                except Exception as exc:
                    log.error("auto_enroll_failed", error=str(exc))

        latency = time.perf_counter() - t_start
        # Fire-and-forget DB log — throttled to max 1 write per 2 seconds
        now_ts = time.time()
        if mode == "identify" and should_identify and (now_ts - self._last_db_log_time) >= 2.0:
            self._last_db_log_time = now_ts
            try:
                log_entry = IdentificationLog(
                    predicted_user_id=display_user,
                    confidence=confidence,
                    svm_confidence=float(
                        identification.get("svm_prediction", {}).get("confidence", 0)
                    )
                    if identification.get("svm_prediction")
                    else 0.0,
                    lstm_confidence=float(
                        identification.get("lstm_prediction", {}).get("confidence", 0)
                    )
                    if identification.get("lstm_prediction")
                    else 0.0,
                    feature_vector=static_vector.tolist(),
                    model_version=identification.get("method", "none"),
                    latency_ms=round(latency * 1000, 2),
                )
                asyncio.create_task(IdentificationLogCRUD.log_identification(log_entry))
            except Exception as exc:
                log.error("stream_log_failed", error=str(exc))

        # Update single person 5-7 second temporal identification state machine
        bbox = _compute_bbox(keypoints)
        if should_identify or self.single_track["first_seen"] is None:
            self._update_single_track(
                raw_user_id=raw_user_id,
                confidence=confidence,
                is_known_for_display=is_known_for_display,
                method=identification.get("method", "skeleton"),
            )

        now = time.time()
        elapsed = now - (self.single_track["first_seen"] or now)
        eval_window = getattr(settings, "identification_window_seconds", 6.0)
        progress = min(elapsed / max(eval_window, 0.1), 1.0)
        time_remaining = max(0.0, eval_window - elapsed)

        display_name = self.single_track["committed_name"]
        display_role = self.single_track["committed_role"]
        display_known = self.single_track["committed_is_known"]
        display_conf = round(self.single_track["committed_confidence"], 4)
        track_state = self.single_track["state"]
        unknown_ms = round((now - self.single_track["unknown_since"]) * 1000) if self.single_track["unknown_since"] else 0

        single_person_obj = {
            "bbox": bbox or [0.05, 0.05, 0.95, 0.95],
            "name": display_name,
            "role": display_role,
            "confidence": display_conf,
            "is_known": display_known,
            "state": track_state,
            "analysis_progress": round(progress, 2),
            "time_remaining": round(time_remaining, 1),
            "keypoints": keypoints,
            "method": self.single_track["committed_method"],
            "track_id": 1,
            "session_id": self.single_track.get("session_id", int(now * 1000)),
            "unknown_ms": unknown_ms,
        }

        return {
            "detected": True,
            "body_visible": True,
            "features_ok": True,
            "frame": self.frame_count,
            "mode": mode,
            "keypoints": keypoints,
            "bbox": bbox,
            "name": display_name,
            "role": display_role,
            "confidence": display_conf,
            "is_known": display_known,
            "state": track_state,
            "analysis_progress": round(progress, 2),
            "time_remaining": round(time_remaining, 1),
            "status_msg": "Person Detected",
            "num_features": len(raw_features),
            "static_features": static_vector.tolist(),
            "gait_ready": gait_ready,
            "gait_buffer": self.gait_ext.buffer_length(),
            "identification": {
                "user": display_name if display_known else "unknown",
                "confidence": display_conf,
                "is_known": display_known,
                "state": track_state,
                "method": self.single_track["committed_method"],
                "top_k": top_candidates,
                "face_confidence": self._last_face_conf,
                "skeleton_confidence": self._last_skeleton_conf,
            },
            "persons": [single_person_obj],
            "latency_ms": round(latency * 1000, 2),
            **result_extra,
        }

    def _build_multi_pose_estimator(self) -> PoseEstimator:
        """Runs in the executor thread — uses static_image_mode=True (IMAGE mode)
        and model_complexity=1 (full model) with Non-Maximum Suppression (Pose NMS)."""
        return PoseEstimator(
            static_image_mode=True,
            num_poses=MULTI_PERSON_MAX_POSES,
            model_complexity=settings.mediapipe_model_complexity,
            min_detection_confidence=settings.min_detection_confidence,
            min_tracking_confidence=settings.min_tracking_confidence,
        )

    async def _verify_person_face(self, client: httpx.AsyncClient, frame_bgr: np.ndarray, kps: List[Dict]) -> Optional[Dict]:
        """Best-effort face verification for one detected person's head crop."""
        crop_b64 = _encode_face_crop(frame_bgr, kps)
        if crop_b64 is None:
            return None
        try:
            resp = await client.post(FACE_VERIFY_URL, json={"live_sample": crop_b64})
            if resp.status_code == 200:
                return resp.json()
        except Exception:
            pass
        return None

    def _log_multi_person_frame(self, persons: List[Dict]):
        """Audit trail so Stats/history reflect activity."""
        now_ts = time.time()
        if not persons or (now_ts - self._last_db_log_time) < 2.0:
            return
        self._last_db_log_time = now_ts

        for p in persons:
            if p.get("state") == "analyzing":
                continue  # don't log transient analyzing state
            try:
                log_entry = IdentificationLog(
                    predicted_user_id=p["name"] if p["is_known"] else "unknown",
                    confidence=p["confidence"],
                    svm_confidence=p["confidence"] if "skeleton" in p.get("method", "") else 0.0,
                    lstm_confidence=0.0,
                    feature_vector=[],
                    model_version=p.get("method", "skeleton"),
                    latency_ms=0.0,
                )
                asyncio.create_task(IdentificationLogCRUD.log_identification(log_entry))
            except Exception as exc:
                log.error("multi_person_log_failed", error=str(exc))

    async def detect_persons(self, frame_b64: str) -> List[Dict]:
        """Detect and identify every person in the frame using multi-model
        skeleton identification (KNN + SVM) fused with best-effort face verification.
        Uses Pose NMS and temporal evaluation to ensure exact person counts and high accuracy.
        """
        frame_bgr = VideoProcessor.base64_to_frame(frame_b64)
        if frame_bgr is None:
            return []
        rgb = self.processor.preprocess_frame(frame_bgr)

        loop = asyncio.get_event_loop()

        all_poses = []
        try:
            if self.pose_multi is None:
                self.pose_multi = await asyncio.wait_for(
                    loop.run_in_executor(_multi_person_executor, self._build_multi_pose_estimator),
                    timeout=10.0,
                )

            # estimate_multi runs MediaPipe + Spatial NMS to prevent phantom duplicate detections
            all_poses = await asyncio.wait_for(
                loop.run_in_executor(_multi_person_executor, self.pose_multi.estimate_multi, rgb),
                timeout=MULTI_PERSON_TIMEOUT_S,
            )
        except asyncio.TimeoutError:
            log.warning("multi_person_detect_timeout")

        if not all_poses:
            return []

        await self._refresh_user_name_map()
        await self._refresh_knn_templates()

        # Concurrent face verification
        async with httpx.AsyncClient(timeout=FACE_VERIFY_TIMEOUT_S) as client:
            face_results = await asyncio.gather(
                *[self._verify_person_face(client, frame_bgr, kps) for kps in all_poses],
                return_exceptions=True,
            )

        raw_detections = []
        for kps, face_result in zip(all_poses, face_results):
            if isinstance(face_result, BaseException):
                face_result = None

            bbox = _compute_bbox(kps)
            if bbox is None:
                continue

            name, role, confidence, is_known, method = "Unknown", "Visitor / Unknown", 0.0, False, "none"

            # ── Multi-model scale-invariant skeleton identification (KNN + SVM) ──────────
            body_kps = self.pose.get_body_keypoints(kps)
            if body_kps is not None:
                raw_features = self.static_ext.extract_all(body_kps)
                if raw_features is not None:
                    vector = self.static_ext.to_vector(raw_features)
                    # predictor.identify() runs scale-invariant KNN + SVM fusion
                    ident = self.predictor.identify(static_features=vector)
                    skel_uid = ident.get("predicted_user", "unknown")
                    skel_known = bool(ident.get("is_known", False)) and skel_uid != "unknown"
                    skel_conf = float(ident.get("confidence", 0.0))
                    
                    if skel_known:
                        skel_name = self.user_name_map.get(skel_uid, "Unknown")
                        if skel_name != "Unknown":
                            name = skel_name
                            role = self.user_role_map.get(skel_uid, "caregiver")
                            confidence = skel_conf
                            is_known = True
                            method = ident.get("method", "skeleton")
                    else:
                        # Even if below acceptance threshold, record candidate for temporal consensus
                        if skel_uid != "unknown" and skel_conf >= 0.50:
                            cand_name = self.user_name_map.get(skel_uid)
                            if cand_name:
                                name = cand_name
                                role = self.user_role_map.get(skel_uid, "caregiver")
                        confidence = skel_conf
                        method = ident.get("method", "skeleton")

            # ── Fuse in face verification (if available) ────────────────────────────────
            if face_result and face_result.get("verified"):
                face_conf = float(face_result.get("confidence", 0.0)) / 100.0
                face_name = (face_result.get("caregiver_details") or {}).get("name", "Unknown")
                if face_name and face_name != "Unknown":
                    if is_known and name == face_name:
                        confidence = min(confidence + 0.10, 1.0)
                        method = method + "+face" if method else "face"
                    elif face_conf >= confidence or not is_known:
                        name, role, confidence, is_known = face_name, "caregiver", face_conf, True
                        method = "face"

            raw_detections.append({
                "bbox": bbox,
                "name": name,
                "role": role,
                "confidence": min(confidence, 1.0),
                "is_known": is_known,
                "method": method,
                "keypoints": [{"x": kp["x"], "y": kp["y"], "visibility": kp["visibility"]} for kp in kps],
            })

        # Disambiguate duplicate raw detections in current frame
        seen_names = {}
        for idx, det in enumerate(raw_detections):
            name_val = det["name"]
            if det["is_known"] and name_val != "Unknown":
                if name_val in seen_names:
                    prev_idx = seen_names[name_val]
                    if det["confidence"] > raw_detections[prev_idx]["confidence"]:
                        raw_detections[prev_idx]["name"] = "Unknown"
                        raw_detections[prev_idx]["role"] = "Visitor / Unknown"
                        raw_detections[prev_idx]["is_known"] = False
                        seen_names[name_val] = idx
                    else:
                        det["name"] = "Unknown"
                        det["role"] = "Visitor / Unknown"
                        det["is_known"] = False
                else:
                    seen_names[name_val] = idx

        persons = self._stabilize_tracks(raw_detections)
        self._log_multi_person_frame(persons)
        return persons

    def _stabilize_tracks(self, raw_detections: List[Dict]) -> List[Dict]:
        """Immediate real-time identification + Track Stabilization."""
        now = time.time()

        # Drop tracks absent for longer than TRACK_EXPIRE_S
        self.tracks = [t for t in self.tracks if now - t["last_seen"] < TRACK_EXPIRE_S]
        for t in self.tracks:
            t["_matched"] = False

        output = []
        for raw in raw_detections:
            x1, y1, x2, y2 = raw["bbox"]
            cx, cy = (x1 + x2) / 2.0, (y1 + y2) / 2.0

            track = None
            best_dist = TRACK_MATCH_DISTANCE
            for t in self.tracks:
                if t["_matched"]:
                    continue
                dist = math.hypot(t["cx"] - cx, t["cy"] - cy)
                if dist < best_dist:
                    track, best_dist = t, dist

            is_known = bool(raw["is_known"]) and raw["name"] not in ("Unknown", "Unknown Person", "Analyzing Posture...")
            st_name = raw["name"] if is_known else "Unknown Person"
            st_role = raw["role"] if is_known else "Visitor / Unregistered"
            st_state = "identified" if is_known else "unknown"

            if track is None:
                self._next_track_id += 1
                track = {
                    "id": self._next_track_id,
                    "cx": cx,
                    "cy": cy,
                    "first_seen": now,
                    "last_seen": now,
                    "_matched": True,
                    "state": st_state,
                    "observations": [],
                    "committed_name": st_name,
                    "committed_role": st_role,
                    "committed_is_known": is_known,
                    "committed_confidence": float(raw["confidence"]),
                    "committed_method": raw["method"],
                    "unknown_since": now if not is_known else None,
                }
                self.tracks.append(track)
            else:
                track["cx"] = TRACK_POSITION_SMOOTHING_ALPHA * cx + (1 - TRACK_POSITION_SMOOTHING_ALPHA) * track["cx"]
                track["cy"] = TRACK_POSITION_SMOOTHING_ALPHA * cy + (1 - TRACK_POSITION_SMOOTHING_ALPHA) * track["cy"]
                track["last_seen"] = now
                track["_matched"] = True
                track["state"] = st_state
                track["committed_name"] = st_name
                track["committed_role"] = st_role
                track["committed_is_known"] = is_known
                track["committed_confidence"] = float(raw["confidence"])
                track["committed_method"] = raw["method"]
                if is_known:
                    track["unknown_since"] = None
                elif not track.get("unknown_since"):
                    track["unknown_since"] = now

            unknown_ms = round((now - track["unknown_since"]) * 1000) if track.get("unknown_since") else 0

            output.append({
                "bbox": raw["bbox"],
                "keypoints": raw["keypoints"],
                "name": track["committed_name"],
                "role": track["committed_role"],
                "confidence": round(track["committed_confidence"], 4),
                "is_known": track["committed_is_known"],
                "state": track["state"],
                "method": track["committed_method"],
                "track_id": track["id"],
                "unknown_ms": unknown_ms,
                "analysis_progress": 1.0,
                "time_remaining": 0.0,
            })

        # Ensure unique enrolled identities across active tracks
        seen_output_names = {}
        for idx, p in enumerate(output):
            name_val = p["name"]
            if p["is_known"] and name_val not in ("Unknown", "Unknown Person", "Analyzing Posture..."):
                if name_val in seen_output_names:
                    prev_idx = seen_output_names[name_val]
                    if p["confidence"] > output[prev_idx]["confidence"]:
                        output[prev_idx]["name"] = "Unknown Person"
                        output[prev_idx]["role"] = "Visitor / Unregistered"
                        output[prev_idx]["is_known"] = False
                        output[prev_idx]["state"] = "unknown"
                        seen_output_names[name_val] = idx
                    else:
                        p["name"] = "Unknown Person"
                        p["role"] = "Visitor / Unregistered"
                        p["is_known"] = False
                        p["state"] = "unknown"
                else:
                    seen_output_names[name_val] = idx

        return output

    async def build_multi_person_result(self, frame_b64: str) -> Dict:
        """Full response for one frame in detect_mode="multi" — used by both the
        webcam (/ws/stream) and IP-camera (/ws/ip-stream) handlers. Deliberately
        independent of process_frame() above: no gait/LSTM, no single-person
        alert bookkeeping, none of that applies once a frame can contain
        several people at once."""
        t_start = time.perf_counter()
        self.frame_count += 1
        persons = await self.detect_persons(frame_b64)
        return {
            "detected": len(persons) > 0,
            "persons": persons,
            "frame": self.frame_count,
            "mode": "identify",
            "latency_ms": round((time.perf_counter() - t_start) * 1000, 2),
        }

    def cleanup(self):
        self.pose.close()
        if self.pose_multi is not None:
            self.pose_multi.close()


# Global predictor reference (set from gateway main)
_predictor: Optional[Predictor] = None


def set_predictor(p: Predictor):
    global _predictor
    _predictor = p


@router.websocket("/ws/stream")
async def websocket_stream(websocket: WebSocket):
    """WebSocket endpoint for real-time video processing."""
    await websocket.accept()
    log.info("websocket_connected")

    if _predictor is None:
        await websocket.send_json({"error": "Predictor not initialized"})
        await websocket.close()
        return

    pipeline = StreamPipeline(_predictor)

    try:
        while True:
            data = await websocket.receive_text()

            try:
                msg = json.loads(data)
                frame_b64 = msg.get("frame", "")
                mode = msg.get("mode", "identify")
                user_id = msg.get("user_id")
                enroll_type = msg.get("enroll_type", "skeleton")
                detect_mode = msg.get("detect_mode", "single")
            except json.JSONDecodeError:
                frame_b64 = data
                mode = "identify"
                user_id = None
                enroll_type = "skeleton"
                detect_mode = "single"

            if not frame_b64:
                continue

            try:
                result = await pipeline.process_frame(frame_b64, mode=mode, user_id=user_id, enroll_type=enroll_type)
                await websocket.send_json(result)
            except Exception as frame_err:
                log.error("frame_processing_error", error=str(frame_err))
                await websocket.send_json({
                    "detected": False,
                    "persons": [],
                    "frame": pipeline.frame_count,
                    "mode": mode,
                    "error": str(frame_err),
                })

    except WebSocketDisconnect:
        log.info("websocket_disconnected")
    except Exception as exc:
        log.error("websocket_error", error=str(exc))
    finally:
        pipeline.cleanup()


# ── IP Camera Server-Side Streaming ──────────────────────────────────────────

def _open_rtsp(rtsp_url: str, max_retries: int = 3):
    """Try to open an RTSP stream with OpenCV. Returns cap or None."""
    import cv2
    for attempt in range(max_retries):
        cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        if cap.isOpened():
            log.info("rtsp_opened", url=rtsp_url, attempt=attempt + 1)
            return cap
        cap.release()
        log.warning("rtsp_retry", attempt=attempt + 1, url=rtsp_url)
        time.sleep(1)
    return None


def _discover_rtsp(host: str, user: str, password: str) -> Optional[str]:
    """Try common Hikvision/ONVIF RTSP paths and return the first one that works."""
    import cv2
    paths = [
        "/stream1",
        "/h264/ch1/main/av_stream",
        "/h264/ch01/main/av_stream",
        "/live/ch00_0",
        "/live/main",
        "/Streaming/Channels/101",
        "/cam/realmonitor?channel=1&subtype=0",
    ]
    for path in paths:
        url = f"rtsp://{user}:{password}@{host}:554{path}"
        cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        ok = cap.isOpened()
        cap.release()
        if ok:
            log.info("rtsp_discovered", url=url)
            return url
        log.debug("rtsp_path_failed", path=path)
    return None


@router.websocket("/ws/ip-stream")
async def websocket_ip_stream(websocket: WebSocket):
    """Server-side IP camera streaming endpoint.

    Flow:
      Server opens RTSP → reads frame → processes through pipeline
      → sends result JSON + annotated JPEG frame to browser.
      Browser never needs direct camera access.
    """
    await websocket.accept()
    log.info("ip_stream_connected")

    if _predictor is None:
        await websocket.send_json({"error": "Predictor not initialized"})
        await websocket.close()
        return

    # Check for runtime RTSP URL override from the client (cmd: set_rtsp), and
    # whether this connection wants multi-person detection.
    detect_mode = "single"
    try:
        first_msg_raw = await asyncio.wait_for(websocket.receive_text(), timeout=2.0)
        first_msg = json.loads(first_msg_raw)
        detect_mode = first_msg.get("detect_mode", "single")
        if first_msg.get("cmd") == "set_rtsp" and first_msg.get("url"):
            rtsp_url = first_msg["url"].strip()
            log.info("rtsp_override_from_client", url=rtsp_url)
    except (asyncio.TimeoutError, json.JSONDecodeError):
        pass  # No override message — use .env value

    # Resolve RTSP URL (fall back to auto-discovery if still empty)
    if not rtsp_url:
        rtsp_url = settings.ip_camera_rtsp_url.strip()
    if not rtsp_url and settings.ip_camera_host:
        await websocket.send_json({
            "status": "discovering",
            "msg": f"Auto-discovering RTSP path on {settings.ip_camera_host}..."
        })
        loop = asyncio.get_event_loop()
        rtsp_url = await loop.run_in_executor(
            _cpu_executor,
            _discover_rtsp,
            settings.ip_camera_host,
            settings.ip_camera_user,
            settings.ip_camera_pass,
        )

    if not rtsp_url:
        await websocket.send_json({
            "error": "No RTSP URL configured and auto-discovery failed. "
                     "Set IP_CAMERA_RTSP_URL in .env or enter it in the dashboard"
        })
        await websocket.close()
        return

    # Open camera in executor (blocking)
    loop = asyncio.get_event_loop()
    cap = await loop.run_in_executor(_cpu_executor, _open_rtsp, rtsp_url)

    if cap is None:
        await websocket.send_json({
            "error": f"Cannot connect to IP camera at {rtsp_url}. "
                     "Check network, credentials, and RTSP path."
        })
        await websocket.close()
        return

    await websocket.send_json({
        "status": "connected",
        "msg": f"IP camera connected: {rtsp_url}",
        "rtsp_url": rtsp_url,
    })

    import cv2, base64 as b64mod
    pipeline = StreamPipeline(_predictor)
    consecutive_failures = 0

    try:
        while True:
            # Read frame from RTSP in thread pool (blocking I/O)
            def _read_frame():
                ret, frame = cap.read()
                return ret, frame

            ret, frame_bgr = await loop.run_in_executor(_cpu_executor, _read_frame)

            if not ret or frame_bgr is None:
                consecutive_failures += 1
                if consecutive_failures >= 30:
                    await websocket.send_json({
                        "error": "IP camera stream lost. Too many read failures."
                    })
                    break
                await asyncio.sleep(0.05)
                continue

            consecutive_failures = 0

            # Encode frame to base64 JPEG (same format as webcam pipeline expects)
            def _encode_frame(bgr):
                _, buf = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, 60])
                return b64mod.b64encode(buf).decode("utf-8")

            frame_b64 = await loop.run_in_executor(
                _cpu_executor, _encode_frame, frame_bgr
            )

            # Run the full single-person pipeline
            result = await pipeline.process_frame(frame_b64, mode="identify")

            # Attach the raw camera frame as base64 so the browser can display it
            result["camera_frame"] = frame_b64

            await websocket.send_json(result)

            # Small yield to keep event loop responsive
            await asyncio.sleep(0)

    except WebSocketDisconnect:
        log.info("ip_stream_disconnected")
    except Exception as exc:
        log.error("ip_stream_error", error=str(exc))
    finally:
        cap.release()
        pipeline.cleanup()
        log.info("ip_stream_closed")

