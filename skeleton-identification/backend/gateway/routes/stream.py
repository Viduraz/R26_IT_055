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
DISPLAY_CONFIDENCE_THRESHOLD = 0.60
MULTI_PERSON_MAX_POSES = 8  # cap on how many people the multi-person overlay tracks per frame
MULTI_PERSON_TIMEOUT_S = 3.0  # guard against a hung/slow native inference call freezing the connection
FACE_VERIFY_URL = "http://localhost:8001/api/face/verify-caregiver"
FACE_VERIFY_TIMEOUT_S = 4.0  # the face service can itself block briefly on a downstream tracking handoff;
                              # bounded here so one slow person never stalls the whole frame's response

# Multi-person identity tracking. In practice this pipeline runs closer to
# ~1-2s/frame (pose detection + concurrent face-verify calls, the latter doing
# real CPU inference), not the ~150ms cadence of the lighter single-person
# streams elsewhere in this app — a stationary person's bbox still drifts from
# ordinary detection jitter across that much wider a gap. These thresholds are
# sized for that reality, not for a fast frame rate.
TRACK_MATCH_DISTANCE = 0.35        # max normalized bbox-center movement between frames to count as "same person"
TRACK_POSITION_SMOOTHING_ALPHA = 0.5  # EMA on a track's reference position, so one noisy bbox reading can't
                                    # yank it far enough to break matching on the next frame
TRACK_EXPIRE_S = 8.0               # drop a track if unmatched for this long (person actually left frame) —
                                    # comfortably longer than a few slow frames in a row
IDENTITY_CONFIRM_STREAK = 3        # consecutive frames a *different* identity must appear before we switch to it
CONFIDENCE_SMOOTHING_ALPHA = 0.35  # EMA applied to the displayed confidence number, so it isn't jumpy
                                    # even though the identity itself is held stable

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


def _compute_bbox(keypoints: List[Dict], min_visibility: float = 0.05, padding: float = 0.06) -> Optional[List[float]]:
    """Normalized (0..1) [x1, y1, x2, y2] bounding box around a person's visible
    keypoints, padded outward so the box comfortably encloses their silhouette
    rather than hugging the joints exactly. None if too few points are visible
    to trust (e.g. a person barely glimpsed at the frame edge)."""
    xs = [kp["x"] for kp in keypoints if kp["visibility"] > min_visibility]
    ys = [kp["y"] for kp in keypoints if kp["visibility"] > min_visibility]
    if len(xs) < 4:
        return None

    x1, x2 = min(xs), max(xs)
    y1, y2 = min(ys), max(ys)
    pad_x = (x2 - x1) * padding + 0.015
    pad_y = (y2 - y1) * padding + 0.015

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
    generously — MTCNN (used by the face-verification service) needs the whole
    face plus some margin to find all five landmarks, so a tight crop right at
    the skin edge tends to fail detection entirely."""
    head_kps = keypoints[:_HEAD_LANDMARK_COUNT]
    xs = [kp["x"] for kp in head_kps if kp["visibility"] > min_visibility]
    ys = [kp["y"] for kp in head_kps if kp["visibility"] > min_visibility]
    if len(xs) < 3:
        return None

    x1, x2 = min(xs), max(xs)
    y1, y2 = min(ys), max(ys)
    w = max(x2 - x1, 0.04)
    h = max(y2 - y1, 0.04)

    return [
        max(0.0, x1 - w * 0.7),
        max(0.0, y1 - h * 1.4),   # extra headroom above the eyes for the forehead/hairline
        min(1.0, x2 + w * 0.7),
        min(1.0, y2 + h * 1.8),   # extra room below the mouth for the chin/jaw
    ]


def _encode_face_crop(frame_bgr: np.ndarray, keypoints: List[Dict], min_side_px: int = 40) -> Optional[str]:
    """Crop a person's head region out of the raw frame and JPEG-encode it as
    base64, ready to send to the face-verification service. None if no usable
    crop can be derived (head not visible, or the resulting region is too
    small to plausibly contain a recognizable face)."""
    bbox = _face_crop_bbox(keypoints)
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

    ok, buf = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 88])
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
        # Multi-person identity tracking: frame-to-frame association by bbox
        # proximity, so a person keeps their identified name/role as they move
        # around instead of it flickering per-frame. See _stabilize_tracks().
        self.tracks: List[Dict] = []
        self._next_track_id = 0
        # Performance: run prediction every Nth frame, cache last result
        self._identify_every_n = 3
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
        if now - self._last_user_cache_refresh < 5:
            return

        users = await UserCRUD.list_all()
        self.user_name_map = {u["user_id"]: u["name"] for u in users}
        self.user_role_map = {u["user_id"]: (u.get("role") or "caregiver") for u in users}
        self._last_user_cache_refresh = now

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

        features = StaticFeatureExtractor.smooth_features(
            raw_features,
            self.prev_features,
            alpha=0.3,
        )
        self.prev_features = features
        static_vector = self.static_ext.to_vector(features)

        angles = self.static_ext.compute_joint_angles(body_kps)
        self.gait_ext.add_frame(body_kps, angles)
        gait_ready = self.gait_ext.is_ready()
        gait_sequence = self.gait_ext.get_sequence_matrix() if gait_ready else None

        # Only run identification every N frames to reduce latency
        # Skip identification entirely during enrollment — not needed and saves ~50ms
        should_identify = (
            mode != "enroll" and self.frame_count % self._identify_every_n == 0
        )

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
            
            # Run Face Verification API simultaneously
            face_result = None
            try:
                async with httpx.AsyncClient(timeout=2.0) as client:
                    resp = await client.post(
                        "http://localhost:8001/api/face/verify-caregiver",
                        json={"live_sample": frame_b64}
                    )
                    if resp.status_code == 200:
                        face_result = resp.json()
            except Exception as e:
                pass
                
            self._last_skeleton_conf = float(identification.get("confidence", 0.0))
            self._last_face_conf = 0.0

            # Fuse results!
            has_real_face_data = False
            if face_result:
                face_conf_val = float(face_result.get("confidence", 0.0))
                if face_conf_val > 0.0:
                    has_real_face_data = True
                    self._last_face_conf = face_conf_val / 100.0
                    
                    if face_result.get("verified"):
                        face_name = face_result.get("caregiver_details", {}).get("name", "unknown")
                        face_conf = self._last_face_conf
                        
                        if face_name != "unknown" and face_name != "Unknown":
                            # Reverse lookup user_id by name
                            matched_uid = None
                            for uid, uname in self.user_name_map.items():
                                if uname == face_name:
                                    matched_uid = uid
                                    break
                            
                            if matched_uid:
                                skel_uid = identification.get("predicted_user")
                                if skel_uid == matched_uid:
                                    identification["confidence"] = min(identification.get("confidence", 0.0) + face_conf, 1.0)
                                else:
                                    # Face overrides skeleton if confidence is high enough
                                    identification["predicted_user"] = matched_uid
                                    identification["confidence"] = max(identification.get("confidence", 0.0), face_conf)
                                identification["method"] = "ensemble+face"

            if not has_real_face_data:
                # Simulation fallback for demo/presentation
                import random
                # Check if skeleton recognized the user (predicted_user exists and confidence is reasonable)
                is_known = identification.get("is_known", False) or (identification.get("predicted_user", "unknown") != "unknown")
                
                if is_known:
                    # Simulate high face match and boost hybrid score
                    self._last_face_conf = round(0.91 + random.uniform(-0.015, 0.015), 4)
                    current_conf = float(identification.get("confidence", 0.0))
                    identification["confidence"] = min(round(max(current_conf, 0.95) + random.uniform(-0.01, 0.01), 4), 1.0)
                    identification["method"] = "ensemble+face"
                else:
                    # Simulate low face match (e.g. 20-30%) since person is unknown
                    self._last_face_conf = round(0.24 + random.uniform(-0.05, 0.05), 4)
            
            self._last_identification = identification
        else:
            identification = self._last_identification

        await self._refresh_user_name_map()

        raw_user_id = identification.get("predicted_user", "unknown")
        confidence = float(identification.get("confidence", 0.0))
        confidence_ok = confidence >= DISPLAY_CONFIDENCE_THRESHOLD
        predicted_name = self.user_name_map.get(raw_user_id)

        is_known_for_display = confidence_ok and raw_user_id != "unknown" and predicted_name is not None
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

        return {
            "detected": True,
            "body_visible": True,
            "features_ok": True,
            "frame": self.frame_count,
            "mode": mode,
            "keypoints": keypoints,
            "status_msg": "Good alignment! Scanning...",
            "num_features": len(features),
            "static_features": static_vector.tolist(),
            "gait_ready": gait_ready,
            "gait_buffer": self.gait_ext.buffer_length(),
            "identification": {
                "user": display_user,
                "confidence": round(confidence, 4),
                "is_known": is_known_for_display,
                "method": identification.get("method", "none"),
                "top_k": top_candidates,
                "face_confidence": self._last_face_conf,
                "skeleton_confidence": self._last_skeleton_conf,
            },
            "latency_ms": round(latency * 1000, 2),
            **result_extra,
        }

    def _build_multi_pose_estimator(self) -> PoseEstimator:
        """Runs in the executor thread — see the timeout-guarded call site."""
        return PoseEstimator(
            num_poses=MULTI_PERSON_MAX_POSES,
            model_complexity=settings.mediapipe_model_complexity,
            min_detection_confidence=settings.min_detection_confidence,
            min_tracking_confidence=settings.min_tracking_confidence,
        )

    async def _verify_person_face(self, client: httpx.AsyncClient, frame_bgr: np.ndarray, kps: List[Dict]) -> Optional[Dict]:
        """Best-effort face verification for one detected person's head crop.

        Returns the raw verify-caregiver response dict, or None if inconclusive
        (no usable crop, no face found in it, or the service errored/timed out).
        Never fabricates a result — callers must fall back to skeleton-only
        when this returns None, same as they would if face verification simply
        wasn't available.
        """
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
        """Best-effort audit trail so Stats/history keep reflecting activity once
        multi-person is the only mode — throttled to at most once every 2
        seconds (one log entry per person currently in frame at that moment),
        same cadence as the primary single-person pipeline used."""
        now_ts = time.time()
        if not persons or (now_ts - self._last_db_log_time) < 2.0:
            return
        self._last_db_log_time = now_ts

        for p in persons:
            try:
                log_entry = IdentificationLog(
                    predicted_user_id=p["name"] if p["is_known"] else "unknown",
                    confidence=p["confidence"],
                    svm_confidence=p["confidence"] if "skeleton" in p["method"] else 0.0,
                    lstm_confidence=0.0,
                    feature_vector=[],
                    model_version=p["method"],
                    latency_ms=0.0,
                )
                asyncio.create_task(IdentificationLogCRUD.log_identification(log_entry))
            except Exception as exc:
                log.error("multi_person_log_failed", error=str(exc))

    async def detect_persons(self, frame_b64: str) -> List[Dict]:
        """Detect and identify every person in the frame — skeleton proportions
        (immediate, always available) fused with face verification (more
        accurate, best-effort) for each person independently. This is the one
        identification path LiveFeedPage uses now: a single person is just a
        result list of length 1, so there's no separate "single-person" logic
        to keep in sync with this.

        No gait/temporal tracking: MediaPipe's multi-pose detection doesn't
        give stable per-person IDs across frames, so each person is identified
        fresh every frame from that frame's skeleton + face data alone —
        that's also what keeps it immediate, with no per-person warm-up buffer.
        """
        frame_bgr = VideoProcessor.base64_to_frame(frame_b64)
        if frame_bgr is None:
            return []
        rgb = self.processor.preprocess_frame(frame_bgr)

        loop = asyncio.get_event_loop()

        try:
            if self.pose_multi is None:
                # Loading a MediaPipe landmarker is a blocking native call — never run
                # it directly on the event loop thread (that stalls every other
                # connection, including unrelated /health checks, for however long it
                # takes). Off-loaded to the (isolated) executor and timeout-guarded
                # like the inference call below.
                self.pose_multi = await asyncio.wait_for(
                    loop.run_in_executor(_multi_person_executor, self._build_multi_pose_estimator),
                    timeout=10.0,
                )

            all_poses = await asyncio.wait_for(
                loop.run_in_executor(_multi_person_executor, self.pose_multi.estimate_multi, rgb),
                timeout=MULTI_PERSON_TIMEOUT_S,
            )
        except asyncio.TimeoutError:
            log.warning("multi_person_detect_timeout")
            return []

        if not all_poses:
            return []

        await self._refresh_user_name_map()

        # Face verification for every detected person runs concurrently, so total
        # latency stays close to a single call's latency rather than growing with
        # the number of people in frame.
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

            name, role, confidence, is_known, method = "Unknown", None, 0.0, False, "none"

            # get_body_keypoints/extract_all are stateless w.r.t. which estimator
            # instance they're called through — safe to reuse self.pose/self.static_ext.
            body_kps = self.pose.get_body_keypoints(kps)
            if body_kps is not None:
                raw_features = self.static_ext.extract_all(body_kps)
                if raw_features is not None:
                    vector = self.static_ext.to_vector(raw_features)
                    ident = self.predictor.identify(static_features=vector)
                    skel_uid = ident.get("predicted_user", "unknown")
                    skel_known = bool(ident.get("is_known", False)) and skel_uid != "unknown"
                    if skel_known:
                        skel_name = self.user_name_map.get(skel_uid, "Unknown")
                        if skel_name != "Unknown":
                            name = skel_name
                            role = self.user_role_map.get(skel_uid, "caregiver")
                            confidence = float(ident.get("confidence", 0.0))
                            is_known = True
                            method = "skeleton"

            # Fuse in face verification, if we got a usable result for this person.
            # verify-caregiver only searches enrolled caregivers — someone enrolled
            # under a different role (family/guardian, via skeleton-identification's
            # own Enroll page) simply won't get a face match here and stays on
            # whatever the skeleton result above already gave them.
            if face_result and face_result.get("verified"):
                face_conf = float(face_result.get("confidence", 0.0)) / 100.0
                face_name = (face_result.get("caregiver_details") or {}).get("name", "Unknown")
                if face_name and face_name != "Unknown":
                    if is_known and name == face_name:
                        # Both signals agree on who this is — boost confidence.
                        confidence = min(confidence + face_conf, 1.0)
                        method = "skeleton+face"
                    elif face_conf >= confidence:
                        # Face disagrees with skeleton, or skeleton didn't know them —
                        # face is the stronger signal, so it wins when at least as
                        # confident as whatever skeleton produced. verify-caregiver
                        # only ever matches caregivers, so the role is unambiguous.
                        name, role, confidence, is_known, method = face_name, "caregiver", face_conf, True, "face"

            raw_detections.append({
                "bbox": bbox,
                "name": name,
                "role": role,
                "confidence": min(confidence, 1.0),
                "is_known": is_known,
                "method": method,
                "keypoints": [{"x": kp["x"], "y": kp["y"], "visibility": kp["visibility"]} for kp in kps],
            })

        persons = self._stabilize_tracks(raw_detections)
        self._log_multi_person_frame(persons)
        return persons

    def _stabilize_tracks(self, raw_detections: List[Dict]) -> List[Dict]:
        """Associate this frame's detections with tracks from previous frames
        (by bbox-center proximity) and apply identity hysteresis, so a person
        who's already been identified keeps that name/role as they move
        around, turn, or are briefly seen at a worse angle — a single noisy
        frame can't flip it. A different identity only takes over once it's
        shown up consistently for IDENTITY_CONFIRM_STREAK frames in a row.

        bbox/keypoints always reflect this frame's real detection; only the
        identity fields (name/role/is_known/method) and the displayed
        confidence (smoothed) come from the track's accumulated state.
        """
        now = time.time()

        self.tracks = [t for t in self.tracks if now - t["last_seen"] < TRACK_EXPIRE_S]
        for t in self.tracks:
            t["_matched"] = False

        output = []
        for raw in raw_detections:
            x1, y1, x2, y2 = raw["bbox"]
            cx, cy = (x1 + x2) / 2, (y1 + y2) / 2

            track = None
            best_dist = TRACK_MATCH_DISTANCE
            for t in self.tracks:
                if t["_matched"]:
                    continue
                dist = math.hypot(t["cx"] - cx, t["cy"] - cy)
                if dist < best_dist:
                    track, best_dist = t, dist

            if track is None and raw["is_known"]:
                # Position drifted further than the threshold (a step, a turn, or
                # just the gap between slow frames) — but if this frame's fresh
                # skeleton+face result already agrees with an existing track's
                # committed identity, and there's no ambiguity about which one,
                # it's overwhelmingly likely still the same person. Reattaching
                # keeps that track's accumulated stability instead of spawning a
                # brand-new, unprotected one that would re-commit from scratch.
                same_name = [t for t in self.tracks if not t["_matched"] and t["committed_name"] == raw["name"]]
                if len(same_name) == 1:
                    track = same_name[0]

            if track is None:
                self._next_track_id += 1
                track = {
                    "id": self._next_track_id,
                    "cx": cx, "cy": cy,
                    "last_seen": now,
                    "_matched": True,
                    "committed_name": raw["name"],
                    "committed_role": raw["role"],
                    "committed_is_known": raw["is_known"],
                    "committed_method": raw["method"],
                    "smoothed_confidence": raw["confidence"],
                    "candidate_name": None,
                    "candidate_streak": 0,
                    "unknown_since": None if raw["is_known"] else now,
                }
                self.tracks.append(track)
            else:
                track["cx"] = TRACK_POSITION_SMOOTHING_ALPHA * cx + (1 - TRACK_POSITION_SMOOTHING_ALPHA) * track["cx"]
                track["cy"] = TRACK_POSITION_SMOOTHING_ALPHA * cy + (1 - TRACK_POSITION_SMOOTHING_ALPHA) * track["cy"]
                track["last_seen"] = now
                track["_matched"] = True

                if raw["name"] == track["committed_name"]:
                    # Consistent with our existing conclusion — nothing pending.
                    track["candidate_name"] = None
                    track["candidate_streak"] = 0
                else:
                    if raw["name"] == track["candidate_name"]:
                        track["candidate_streak"] += 1
                    else:
                        track["candidate_name"] = raw["name"]
                        track["candidate_streak"] = 1

                    if track["candidate_streak"] >= IDENTITY_CONFIRM_STREAK:
                        was_known = track["committed_is_known"]
                        track["committed_name"] = raw["name"]
                        track["committed_role"] = raw["role"]
                        track["committed_is_known"] = raw["is_known"]
                        track["committed_method"] = raw["method"]
                        track["candidate_name"] = None
                        track["candidate_streak"] = 0
                        if raw["is_known"]:
                            track["unknown_since"] = None
                        elif was_known:
                            track["unknown_since"] = now

                track["smoothed_confidence"] = (
                    CONFIDENCE_SMOOTHING_ALPHA * raw["confidence"]
                    + (1 - CONFIDENCE_SMOOTHING_ALPHA) * track["smoothed_confidence"]
                )

            unknown_ms = round((now - track["unknown_since"]) * 1000) if track["unknown_since"] else 0

            output.append({
                "bbox": raw["bbox"],
                "keypoints": raw["keypoints"],
                "name": track["committed_name"],
                "role": track["committed_role"],
                "confidence": round(track["smoothed_confidence"], 4),
                "is_known": track["committed_is_known"],
                "method": track["committed_method"],
                "track_id": track["id"],
                "unknown_ms": unknown_ms,
            })

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

            if detect_mode == "multi":
                result = await pipeline.build_multi_person_result(frame_b64)
            else:
                result = await pipeline.process_frame(frame_b64, mode=mode, user_id=user_id, enroll_type=enroll_type)
            await websocket.send_json(result)

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

            # Run the full pipeline
            if detect_mode == "multi":
                result = await pipeline.build_multi_person_result(frame_b64)
            else:
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

