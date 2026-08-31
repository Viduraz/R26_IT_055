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

# Identity stability. A single frame is no longer allowed to force a name (the
# threshold-bypassing fallbacks that did so are gone), so an established identity
# is held briefly through the odd inconclusive frame, and a *different* name has
# to win several consecutive frames before it replaces one already on screen.
IDENTITY_HOLD_S = 2.0
IDENTITY_SWITCH_FRAMES = 5

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


def _compute_head_pose(keypoints: List[Dict]) -> Dict:
    """
    Computes real-time head pose (Yaw, Pitch, and classification) from MediaPipe pose head keypoints.
    Keypoint indices:
      0: nose
      2: left_eye, 5: right_eye
      7: left_ear, 8: right_ear
      9: mouth_left, 10: mouth_right
    """
    if not keypoints or len(keypoints) < 11:
        return {"yaw": 0.0, "pitch": 0.0, "pose": "center"}

    nose = keypoints[0]
    l_eye = keypoints[2]
    r_eye = keypoints[5]
    l_ear = keypoints[7]
    r_ear = keypoints[8]
    l_mouth = keypoints[9]
    r_mouth = keypoints[10]

    if nose.get("visibility", 0) < 0.2:
        return {"yaw": 0.0, "pitch": 0.0, "pose": "center"}

    eye_center_x = (l_eye["x"] + r_eye["x"]) / 2.0
    eye_dist = max(abs(l_eye["x"] - r_eye["x"]), 0.03)

    # Yaw offset relative to eye spacing
    yaw_offset = (nose["x"] - eye_center_x) / eye_dist

    # Ear visibility asymmetry
    l_ear_vis = l_ear.get("visibility", 0)
    r_ear_vis = r_ear.get("visibility", 0)
    ear_diff = l_ear_vis - r_ear_vis

    # Vertical pitch ratio
    eye_center_y = (l_eye["y"] + r_eye["y"]) / 2.0
    mouth_center_y = (l_mouth["y"] + r_mouth["y"]) / 2.0
    face_h = max(abs(mouth_center_y - eye_center_y), 0.03)
    pitch_ratio = (nose["y"] - eye_center_y) / face_h

    # Classify Pose
    pose = "center"
    if yaw_offset > 0.26 or ear_diff < -0.35:
        pose = "right"
    elif yaw_offset < -0.26 or ear_diff > 0.35:
        pose = "left"
    elif pitch_ratio < 0.35:
        pose = "up"
    elif pitch_ratio > 0.68:
        pose = "down"

    return {
        "yaw": round(float(yaw_offset), 3),
        "pitch": round(float(pitch_ratio), 3),
        "pose": pose,
    }


# Minimum change (degrees) in any posture component before an enrollment frame is
# accepted as a genuinely new keyframe.
POSE_DIVERSITY_MIN_CHANGE_DEG = 6.0


def _pose_descriptor(body_kps: Dict[str, Dict], angles: Dict[str, float]) -> np.ndarray:
    """Describe the subject's transient posture in degrees.

    Enrollment diversity has to be judged on *posture*, not on the biometric
    vector. The biometric vector is built to stay constant for a given person, so
    using it to detect "the user is holding still" would reject every frame once
    the features became properly invariant. Body yaw is included because turning
    on the spot barely changes internal joint angles but is one of the postures
    the guided protocol asks for.
    """
    components = [float(angles.get(k, 90.0)) for k in sorted(angles.keys())]

    def _coords(name: str) -> Optional[np.ndarray]:
        kp = body_kps.get(name)
        if not kp:
            return None
        if kp.get("has_world"):
            return np.array([kp.get("wx", 0.0), kp.get("wy", 0.0), kp.get("wz", 0.0)], dtype=np.float64)
        return np.array([kp.get("x", 0.0), kp.get("y", 0.0), kp.get("z", 0.0)], dtype=np.float64)

    l_sh, r_sh = _coords("left_shoulder"), _coords("right_shoulder")
    l_hip, r_hip = _coords("left_hip"), _coords("right_hip")

    yaw = 0.0
    if l_sh is not None and r_sh is not None:
        shoulder_vec = r_sh - l_sh
        yaw = float(np.degrees(np.arctan2(shoulder_vec[2], shoulder_vec[0])))
    components.append(yaw)

    lean = 0.0
    if l_sh is not None and r_sh is not None and l_hip is not None and r_hip is not None:
        spine = ((l_sh + r_sh) / 2.0) - ((l_hip + r_hip) / 2.0)
        lean = float(np.degrees(np.arctan2(spine[0], abs(spine[1]) + 1e-6)))
    components.append(lean)

    return np.array(components, dtype=np.float64)


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

        # Multi-pose guided enrollment buffer
        self._enrollment_buffer: List[List[float]] = []
        self._enrollment_gait: List[List[List[float]]] = []
        self._enrollment_user_id: Optional[str] = None
        self._last_enrolled_pose: Optional[np.ndarray] = None

        self.single_track = {
            "first_seen": None,
            "last_seen": None,
            "state": "unknown",
            "status": "UNKNOWN",
            "observations": [],
            "committed_name": "Unknown Person",
            "committed_role": "Visitor / Unregistered",
            "committed_is_known": False,
            "committed_confidence": 0.0,
            "committed_method": "none",
            "unknown_since": None,
            "identified_at": None,
            "pending_name": None,
            "pending_count": 0,
        }
        self.tracks: List[Dict] = []
        self._next_track_id = 0
        self._identify_every_n = 1
        self._last_identification: Dict = {
            "predicted_user": "unknown",
            "confidence": 0.0,
            "is_known": False,
            "status": "UNKNOWN",
            "method": "none",
            "top_k": [],
        }
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
        """Reload biometric templates from database periodically or on enrollment."""
        now = time.time()
        if self.predictor.knn_ready and (now - self._last_knn_refresh < 5):
            return
        try:
            profiles = await FeatureProfileCRUD.get_all_profiles()
            if profiles:
                self.predictor.load_knn_templates(profiles)
        except Exception as exc:
            log.warning("knn_template_refresh_failed", error=str(exc))
        self._last_knn_refresh = now

    def _update_single_track(
        self,
        raw_user_id: str,
        confidence: float,
        is_known_for_display: bool,
        method: str,
        status: Optional[str] = None,
    ):
        """Immediate real-time identification with explicit state tracking."""
        now = time.time()
        if status is None:
            status = "KNOWN" if is_known_for_display else "UNKNOWN"

        # Reset if stream was interrupted / no person seen for > 1.0s
        if self.single_track["first_seen"] is None or (self.single_track["last_seen"] and (now - self.single_track["last_seen"] > 1.0)):
            self.single_track["session_id"] = int(now * 1000)
            self.single_track["first_seen"] = now
            self.single_track["last_seen"] = now
            self.single_track["unknown_since"] = None
        else:
            self.single_track["last_seen"] = now

        cand_name = self.user_name_map.get(raw_user_id) if (raw_user_id != "unknown" and raw_user_id in self.user_name_map) else "Unknown Person"
        cand_role = self.user_role_map.get(raw_user_id, "caregiver") if (raw_user_id != "unknown" and raw_user_id in self.user_role_map) else "Visitor / Unregistered"

        self.single_track["status"] = status
        self.single_track["committed_confidence"] = round(confidence, 4)
        self.single_track["committed_method"] = method

        held_fresh = (
            self.single_track.get("committed_is_known")
            and self.single_track.get("identified_at") is not None
            and (now - self.single_track["identified_at"]) < IDENTITY_HOLD_S
        )

        def _commit_identity():
            self.single_track.update(
                state="identified",
                committed_name=cand_name,
                committed_role=cand_role,
                committed_is_known=True,
                unknown_since=None,
                identified_at=now,
                pending_name=None,
                pending_count=0,
            )

        if status == "KNOWN" and is_known_for_display and cand_name != "Unknown Person":
            if held_fresh and cand_name != self.single_track["committed_name"]:
                # A different name arriving on an already-identified subject has to
                # persist for several consecutive frames before it replaces the one
                # on screen — one marginal frame must never rename the person.
                prev_pending = self.single_track.get("pending_name")
                streak = self.single_track.get("pending_count", 0) + 1 if prev_pending == cand_name else 1
                self.single_track["pending_name"] = cand_name
                self.single_track["pending_count"] = streak
                if streak >= IDENTITY_SWITCH_FRAMES:
                    _commit_identity()
            else:
                _commit_identity()
        elif held_fresh:
            # Hold an established identity through a momentary inconclusive frame.
            self.single_track["unknown_since"] = None
            self.single_track["pending_name"] = None
            self.single_track["pending_count"] = 0
        elif status == "AMBIGUOUS":
            self.single_track.update(
                state="ambiguous",
                committed_name=f"Ambiguous ({cand_name}?)",
                committed_role="Awaiting movement verification",
                committed_is_known=False,
                unknown_since=None,
                identified_at=None,
                pending_name=None,
                pending_count=0,
            )
        else:
            self.single_track.update(
                state="unknown",
                committed_name="Unknown Person",
                committed_role="Visitor / Unregistered",
                committed_is_known=False,
                identified_at=None,
                pending_name=None,
                pending_count=0,
            )
            if not self.single_track["unknown_since"]:
                self.single_track["unknown_since"] = now

    async def _verify_person_face(
        self, client: httpx.AsyncClient, frame_bgr: np.ndarray, keypoints: List[Dict]
    ) -> Optional[Dict]:
        """Crop face and query Face Verification microservice (port 8001)."""
        crop_b64 = _encode_face_crop(frame_bgr, keypoints)
        if not crop_b64:
            return None
        try:
            resp = await client.post(
                "http://localhost:8001/api/face/verify-caregiver",
                json={"live_sample": crop_b64},
            )
            if resp.status_code == 200:
                return resp.json()
        except Exception as e:
            log.debug("face_verify_http_failed", error=str(e))
        return None

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
                self.single_track["identified_at"] = None
                self.single_track["pending_name"] = None
                self.single_track["pending_count"] = 0
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

        body_kps = self.pose.get_all_keypoints_dict(all_kps)
        raw_features = self.static_ext.extract_all(body_kps)
        if raw_features is None:
            return {
                "detected": True,
                "body_visible": False,
                "features_ok": False,
                "frame": self.frame_count,
                "mode": mode,
                "keypoints": keypoints,
                "status_msg": "Shoulders not clearly detected",
                "latency_ms": round((time.perf_counter() - t_start) * 1000, 2),
            }

        static_vector = self.static_ext.to_vector(raw_features)

        angles = self.static_ext.compute_joint_angles(body_kps)
        self.gait_ext.add_frame(body_kps, angles)
        gait_ready = self.gait_ext.is_ready()
        gait_sequence = self.gait_ext.get_sequence_matrix() if gait_ready else None

        is_moving = self.gait_ext.is_moving()
        should_identify = (
            mode != "enroll" and self.frame_count % self._identify_every_n == 0
        )

        await self._refresh_user_name_map()
        await self._refresh_knn_templates()

        if should_identify:
            # Run hybrid identification in thread pool
            loop = asyncio.get_event_loop()
            identification = await loop.run_in_executor(
                _cpu_executor,
                lambda: self.predictor.identify(
                    static_features=static_vector,
                    gait_sequence=gait_sequence,
                    is_moving=is_moving,
                )
            )

            # Concurrent Face Crop Verification
            face_result = None
            try:
                async with httpx.AsyncClient(timeout=1.5) as client:
                    face_result = await self._verify_person_face(client, frame_bgr, all_kps)
            except Exception:
                face_result = None

            # Dual-Biometric Multi-Modal Fusion (Face + Skeleton)
            face_matched_uid = None
            face_conf = 0.0
            if face_result and (face_result.get("verified") or face_result.get("matched")):
                c_details = face_result.get("caregiver_details") or {}
                face_name = c_details.get("name") or face_result.get("caregiver_name") or face_result.get("name") or ""
                face_conf = float(face_result.get("confidence", 0.0)) / 100.0
                if face_name:
                    fn_low = face_name.lower().strip()
                    for uid, uname in self.user_name_map.items():
                        u_low = uname.lower().strip()
                        uid_low = str(uid).lower().strip()
                        if u_low == fn_low or uid_low == fn_low or fn_low in u_low or u_low in fn_low:
                            face_matched_uid = uid
                            break

            skel_uid = identification.get("predicted_user", "unknown")
            skel_conf = float(identification.get("confidence", 0.0))
            skel_status = identification.get("status", "UNKNOWN")

            chosen_user_id = "unknown"
            final_conf = 0.0
            fusion_method = "Unregistered Person"
            ident_status = "UNKNOWN"
            ident_reason_override = None

            # The skeleton branch has already applied open-set rejection and the
            # ambiguity margin. Its verdict is honoured as-is: a KNOWN result may
            # name the person, an AMBIGUOUS one may not, and confidences are
            # reported as measured rather than floored to a reassuring number.

            # 1. Dual Match: Both Face and Skeleton identify the SAME registered user
            if face_matched_uid and skel_status == "KNOWN" and skel_uid == face_matched_uid:
                chosen_user_id = face_matched_uid
                final_conf = min(0.99, max(skel_conf, face_conf) + 0.10)
                fusion_method = "Dual Biometric Verified (Face + Skeleton)"
                ident_status = "KNOWN"

            # 2. Face Only Match: Face microservice confirmed registered identity (>= 35%)
            elif face_matched_uid and face_conf >= 0.35:
                chosen_user_id = face_matched_uid
                final_conf = face_conf
                fusion_method = "Face Verification Match"
                ident_status = "KNOWN"

            # 3. Skeleton Only Match: matcher cleared both threshold and margin
            elif skel_status == "KNOWN" and skel_uid != "unknown":
                chosen_user_id = skel_uid
                final_conf = skel_conf
                fusion_method = "Skeleton Biometric Match"
                ident_status = "KNOWN"

            # 4. Two enrolled templates are too close to separate. Naming the
            #    marginal winner here is what makes person 1 read as person 2, so
            #    the ambiguity is surfaced and movement is requested instead.
            elif skel_status == "AMBIGUOUS" and skel_uid != "unknown":
                chosen_user_id = skel_uid
                final_conf = skel_conf
                fusion_method = "Ambiguous — body proportions too close to separate"
                ident_status = "AMBIGUOUS"
                ident_reason_override = (
                    "Two enrolled profiles match this build almost equally. "
                    "Walk a few steps so gait can break the tie."
                )

            # 5. UNKNOWN / UNREGISTERED PERSON
            identification = {
                **identification,
                "predicted_user": chosen_user_id,
                "confidence": round(final_conf, 2),
                "is_known": ident_status == "KNOWN",
                "status": ident_status,
                "method": fusion_method,
            }
            if ident_reason_override:
                identification["reason"] = ident_reason_override

            self._last_face_conf = face_conf
            self._last_skeleton_conf = skel_conf
            self._last_identification = identification
        else:
            identification = self._last_identification

        await self._refresh_user_name_map()
        await self._refresh_knn_templates()

        raw_user_id = identification.get("predicted_user", "unknown")
        confidence = float(identification.get("confidence", 0.0))
        is_model_known = bool(identification.get("is_known", False))
        ident_status = identification.get("status", "UNKNOWN")
        ident_reason = identification.get("reason", "")
        predicted_name = self.user_name_map.get(raw_user_id) if raw_user_id != "unknown" else None

        is_known_for_display = (
            is_model_known
            and raw_user_id != "unknown"
            and predicted_name is not None
            and ident_status == "KNOWN"
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

        # ── Guided Multi-Pose Enrollment with Diversity Filtering & Bulk Save ──
        result_extra: Dict[str, object] = {}
        head_pose = _compute_head_pose(keypoints)
        result_extra["head_pose"] = head_pose

        if mode == "enroll" and user_id:
            if enroll_type == "face":
                now_ts = time.time()
                # Throttle sample collection: capture frame at most every 120ms
                if (now_ts - getattr(self, "_last_face_sample_time", 0.0)) >= 0.12:
                    self.face_samples.append(frame_b64)
                    self._last_face_sample_time = now_ts

                count = len(self.face_samples)
                status = "in_progress"
                target_frames = 30

                # Periodically sync progress to MongoDB users collection
                if count > 0:
                    from database.crud import UserCRUD
                    asyncio.create_task(
                        UserCRUD.update_enrollment_status(user_id, "in_progress", count)
                    )

                if count >= target_frames:
                    status = "completed"
                    from database.crud import UserCRUD
                    asyncio.create_task(
                        UserCRUD.update_enrollment_status(user_id, "completed", count)
                    )

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
                                        from datetime import datetime
                                        await MongoDB.get_collection("users").update_one(
                                            {"user_id": uid},
                                            {"$set": {
                                                "face_embeddings": emb,
                                                "face_verification_status": "enrolled",
                                                "enrollment_status": "completed",
                                                "enrollment_frames_count": len(samples),
                                                "updated_at": datetime.utcnow(),
                                            }}
                                        )
                        except Exception as e:
                            log.error("face_enroll_failed", error=str(e))

                    asyncio.create_task(do_face_enroll(user_id, list(self.face_samples)))

                result_extra = {
                    "head_pose": head_pose,
                    "frames_collected": count,
                    "enrollment_status": status,
                    "progress": min(count / target_frames * 100, 100),
                }
            else:
                # Skeleton Guided Multi-Pose Enrollment
                if self._enrollment_user_id != user_id:
                    self._enrollment_user_id = user_id
                    self._enrollment_buffer = []
                    self._enrollment_gait = []
                    self._last_enrolled_pose = None

                now_skel_ts = time.time()
                is_time_elapsed = (now_skel_ts - getattr(self, "_last_skel_sample_time", 0.0)) >= 0.30

                # Posture Diversity Check, measured on transient posture rather than
                # on the biometric vector: capture one keyframe per distinct pose and
                # wait for the user to actually move before taking the next.
                pose_desc = _pose_descriptor(body_kps, angles)
                is_diverse = True
                posture_holding = False
                if self._last_enrolled_pose is not None and len(self._last_enrolled_pose) == len(pose_desc):
                    max_change = float(np.max(np.abs(pose_desc - self._last_enrolled_pose)))
                    if max_change < POSE_DIVERSITY_MIN_CHANGE_DEG:
                        is_diverse = False
                        posture_holding = True

                if is_time_elapsed and is_diverse:
                    self._enrollment_buffer.append(static_vector.tolist())
                    self._last_enrolled_pose = pose_desc
                    self._last_skel_sample_time = now_skel_ts
                    if gait_sequence is not None:
                        self._enrollment_gait.append(gait_sequence.tolist())

                count = len(self._enrollment_buffer)
                target_frames = 150

                # 15-Stage Comprehensive High-Precision Posture Protocol (10 frames per stage)
                GUIDED_STAGES = [
                    "Stage 1/15 (Frames 1-10): Neutral Posture — Face Camera Directly",
                    "Stage 2/15 (Frames 11-20): Turn 15° to the Left",
                    "Stage 3/15 (Frames 21-30): Turn 45° to the Left (Quarter Left)",
                    "Stage 4/15 (Frames 31-40): Turn 90° Profile Left (Side View)",
                    "Stage 5/15 (Frames 41-50): Return Center — Raise Arms to A-Pose (45°)",
                    "Stage 6/15 (Frames 51-60): Raise Arms Horizontally (T-Pose)",
                    "Stage 7/15 (Frames 61-70): Lower Arms to Sides Naturally",
                    "Stage 8/15 (Frames 71-80): Turn 15° to the Right",
                    "Stage 9/15 (Frames 81-90): Turn 45° to the Right (Quarter Right)",
                    "Stage 10/15 (Frames 91-100): Turn 90° Profile Right (Side View)",
                    "Stage 11/15 (Frames 101-110): Lean Torso Slightly Left & Right",
                    "Stage 12/15 (Frames 111-120): Take 1 Small Step Back",
                    "Stage 13/15 (Frames 121-130): Take 1 Small Step Forward",
                    "Stage 14/15 (Frames 131-140): Shift Body Weight to Left & Right Leg",
                    "Stage 15/15 (Frames 141-150): Stand Still Facing Camera — Finalizing 150-Frame Dataset",
                ]

                stage_idx = min(count // 10, len(GUIDED_STAGES) - 1)
                stage_prompt = GUIDED_STAGES[stage_idx]

                if posture_holding and count < target_frames:
                    status_msg = "⚠️ Pose held — Please alter your posture or angle to capture next keyframe"
                else:
                    status_msg = f"🟢 Capturing keyframe {count}/150"

                status = "in_progress"
                if count >= target_frames:
                    # No synthetic ±2% scaling here. Scaling the whole vector
                    # inflates every user's template cloud along the same axis,
                    # which grows each template's variance, shrinks the
                    # regularized Mahalanobis distance, and pushes neighbouring
                    # users into overlap — the observed cross-identification.
                    enrolled_vectors = list(self._enrollment_buffer)

                    try:
                        # Single Bulk Database Save
                        await FeatureProfileCRUD.bulk_upsert_samples(
                            user_id=user_id,
                            static_vectors=enrolled_vectors,
                            gait_sequences=self._enrollment_gait if self._enrollment_gait else None,
                            feature_version=StaticFeatureExtractor.FEATURE_VERSION,
                        )
                        await UserCRUD.update_enrollment_status(user_id, "completed", len(enrolled_vectors))
                        # Instant In-Memory Template Reload
                        await self._refresh_knn_templates()
                        status = "completed"
                        stage_prompt = "150-Frame Biometric Dataset Complete! Model updated for Live Feed."
                        status_msg = "✅ Biometric Dataset Enrolled Successfully!"
                    except Exception as exc:
                        log.error("enroll_bulk_save_failed", error=str(exc))
                        status = "failed"

                result_extra = {
                    "frames_collected": count,
                    "enrollment_status": status,
                    "progress": min(count / target_frames * 100, 100),
                    "stage_prompt": stage_prompt,
                    "posture_holding": posture_holding,
                    "status_msg": status_msg,
                }

        latency = time.perf_counter() - t_start
        now_ts = time.time()
        if mode == "identify" and should_identify and (now_ts - self._last_db_log_time) >= 2.0:
            self._last_db_log_time = now_ts
            try:
                log_entry = IdentificationLog(
                    predicted_user_id=display_user,
                    confidence=confidence,
                    feature_vector=static_vector.tolist(),
                    model_version=identification.get("method", "hybrid_biometric"),
                    latency_ms=round(latency * 1000, 2),
                )
                asyncio.create_task(IdentificationLogCRUD.log_identification(log_entry))
            except Exception as exc:
                log.error("stream_log_failed", error=str(exc))

        # Single Person Tracking Update
        bbox = _compute_bbox(keypoints)
        if should_identify or self.single_track["first_seen"] is None:
            self._update_single_track(
                raw_user_id=raw_user_id,
                confidence=confidence,
                is_known_for_display=is_known_for_display,
                method=identification.get("method", "hybrid_biometric"),
                status=ident_status,
            )

        now = time.time()
        elapsed = now - (self.single_track["first_seen"] or now)
        eval_window = getattr(settings, "identification_window_seconds", 0.0)
        progress = 1.0 if eval_window <= 0 else min(elapsed / max(eval_window, 0.1), 1.0)
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
            "status": ident_status,
            "reason": ident_reason,
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
            "status": ident_status,
            "status_msg": ident_reason or ("Person Detected" if display_known else "Unknown Visitor"),
            "analysis_progress": round(progress, 2),
            "time_remaining": round(time_remaining, 1),
            "num_features": len(raw_features),
            "static_features": static_vector.tolist(),
            "gait_ready": gait_ready,
            "is_moving": is_moving,
            "gait_buffer": self.gait_ext.buffer_length(),
            "identification": {
                "user": display_name if display_known else "unknown",
                "confidence": display_conf,
                "is_known": display_known,
                "state": track_state,
                "status": ident_status,
                "reason": ident_reason,
                "method": self.single_track["committed_method"],
                "top_k": top_candidates,
                "face_confidence": self._last_face_conf,
                "skeleton_confidence": self._last_skeleton_conf,
                "benchmarks": identification.get("benchmarks", {}),
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
            status, reason = "UNKNOWN", "No usable skeleton"

            # ── Multi-model scale-invariant skeleton identification + Face fusion ──
            body_kps = self.pose.get_body_keypoints(kps)
            if body_kps is not None:
                raw_features = self.static_ext.extract_all(body_kps)
                if raw_features is not None:
                    vector = self.static_ext.to_vector(raw_features)
                    ident = self.predictor.identify(static_features=vector)
                    skel_uid = ident.get("predicted_user", "unknown")
                    skel_status = ident.get("status", "UNKNOWN")
                    skel_conf = float(ident.get("confidence", 0.0))

                    status = skel_status
                    reason = ident.get("reason", "")
                    confidence = skel_conf
                    method = ident.get("method", "skeleton")

                    # Face verification is the only evidence allowed to name a
                    # person on its own; the skeleton branch must have cleared
                    # both the acceptance threshold and the ambiguity margin.
                    chosen_uid = None
                    face_verified = False
                    if face_result and face_result.get("verified"):
                        f_name = (face_result.get("caregiver_details") or {}).get("name", "")
                        for uid, uname in self.user_name_map.items():
                            if uname.lower() == f_name.lower():
                                chosen_uid = uid
                                face_verified = True
                                break

                    if not chosen_uid and skel_status == "KNOWN" and skel_uid != "unknown":
                        chosen_uid = skel_uid

                    # Deliberately no top-k fallback here. Taking top_k[0] when the
                    # matcher reported UNKNOWN or AMBIGUOUS discards the open-set
                    # rejection and the ambiguity margin, which is exactly how two
                    # people with near-identical templates get each other's name.
                    if chosen_uid and chosen_uid in self.user_name_map:
                        name = self.user_name_map[chosen_uid]
                        role = self.user_role_map.get(chosen_uid, "caregiver")
                        is_known = True
                        status = "KNOWN"
                        if face_verified:
                            face_conf = float(face_result.get("confidence", 0.0)) / 100.0
                            confidence = max(skel_conf, face_conf)
                            method = "Skeleton + Face Fusion" if skel_uid == chosen_uid else "Face Verification Match"
                        else:
                            confidence = skel_conf
                            method = "Skeleton Biometric Match"

            raw_detections.append({
                "bbox": bbox,
                "name": name,
                "role": role,
                "confidence": min(confidence, 1.0),
                "is_known": is_known,
                "method": method,
                "status": status,
                "reason": reason,
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
            raw_status = raw.get("status", "KNOWN" if is_known else "UNKNOWN")
            st_name = raw["name"] if is_known else "Unknown Person"
            if is_known:
                st_role, st_state = raw["role"], "identified"
            elif raw_status == "AMBIGUOUS":
                # Two enrolled templates are too close to call. Naming either one
                # would be a coin flip, so report the ambiguity instead.
                st_role, st_state = "Ambiguous — awaiting movement verification", "ambiguous"
            else:
                st_role, st_state = "Visitor / Unregistered", "unknown"

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
                track["identified_at"] = now if is_known else None
                track["pending_name"] = None
                track["pending_count"] = 0
                self.tracks.append(track)
            else:
                track["cx"] = TRACK_POSITION_SMOOTHING_ALPHA * cx + (1 - TRACK_POSITION_SMOOTHING_ALPHA) * track["cx"]
                track["cy"] = TRACK_POSITION_SMOOTHING_ALPHA * cy + (1 - TRACK_POSITION_SMOOTHING_ALPHA) * track["cy"]
                track["last_seen"] = now
                track["_matched"] = True
                track["committed_confidence"] = float(raw["confidence"])

                held_name = track["committed_name"] if track.get("committed_is_known") else None
                held_fresh = (
                    held_name is not None
                    and track.get("identified_at") is not None
                    and (now - track["identified_at"]) < IDENTITY_HOLD_S
                )

                if is_known and st_name == held_name:
                    track["identified_at"] = now
                    track["pending_name"] = None
                    track["pending_count"] = 0
                    track["state"], track["committed_role"] = st_state, st_role
                    track["committed_method"] = raw["method"]
                elif is_known and held_fresh:
                    # A different name on an already-identified track. Switching on
                    # a single frame is how a momentary near-tie becomes somebody
                    # else's name on screen, so make the new identity earn it.
                    if track.get("pending_name") == st_name:
                        track["pending_count"] += 1
                    else:
                        track["pending_name"], track["pending_count"] = st_name, 1

                    if track["pending_count"] >= IDENTITY_SWITCH_FRAMES:
                        track.update(
                            committed_name=st_name, committed_role=st_role,
                            committed_is_known=True, committed_method=raw["method"],
                            state=st_state, identified_at=now,
                            pending_name=None, pending_count=0,
                        )
                elif is_known:
                    track.update(
                        committed_name=st_name, committed_role=st_role,
                        committed_is_known=True, committed_method=raw["method"],
                        state=st_state, identified_at=now,
                        pending_name=None, pending_count=0,
                    )
                elif held_fresh:
                    # Momentary UNKNOWN/AMBIGUOUS on someone already identified —
                    # hold the established name rather than flickering to "Unknown".
                    track["pending_name"], track["pending_count"] = None, 0
                else:
                    track.update(
                        committed_name=st_name, committed_role=st_role,
                        committed_is_known=False, committed_method=raw["method"],
                        state=st_state, identified_at=None,
                        pending_name=None, pending_count=0,
                    )

                if track["committed_is_known"]:
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
                "status": raw_status,
                "reason": raw.get("reason", ""),
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

