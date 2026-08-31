"""
services/pose_estimation/estimator.py
Extracts 33 skeleton keypoints using MediaPipe Pose (Tasks API).

Updated from legacy mp.solutions.pose to mediapipe.tasks.python.vision.PoseLandmarker
which is required for mediapipe >= 0.10.14.
"""
import mediapipe as mp
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import (
    PoseLandmarker,
    PoseLandmarkerOptions,
    RunningMode,
)
import numpy as np
import cv2
import structlog
from pathlib import Path
from typing import Optional, Dict, List
from dataclasses import dataclass, asdict

log = structlog.get_logger()


@dataclass
class Keypoint:
    """Single skeleton keypoint with 3D coordinates and visibility."""
    index: int
    name: str
    x: float
    y: float
    z: float
    visibility: float


class PoseEstimator:
    """MediaPipe PoseLandmarker wrapper for skeleton keypoint extraction.

    Uses the new Tasks API (mediapipe >= 0.10.14).
    """

    LANDMARK_NAMES = [
        "nose", "left_eye_inner", "left_eye", "left_eye_outer",
        "right_eye_inner", "right_eye", "right_eye_outer",
        "left_ear", "right_ear", "mouth_left", "mouth_right",
        "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
        "left_wrist", "right_wrist", "left_pinky", "right_pinky",
        "left_index", "right_index", "left_thumb", "right_thumb",
        "left_hip", "right_hip", "left_knee", "right_knee",
        "left_ankle", "right_ankle", "left_heel", "right_heel",
        "left_foot_index", "right_foot_index",
    ]

    # Key body landmarks for identification (indices into the 33 landmarks)
    BODY_LANDMARK_INDICES = {
        "left_shoulder": 11, "right_shoulder": 12,
        "left_elbow": 13, "right_elbow": 14,
        "left_wrist": 15, "right_wrist": 16,
        "left_hip": 23, "right_hip": 24,
        "left_knee": 25, "right_knee": 26,
        "left_ankle": 27, "right_ankle": 28,
    }

    # Map model_complexity (0, 1, 2) to task model files
    _MODEL_FILES = {
        0: "pose_landmarker_lite.task",
        1: "pose_landmarker_full.task",
        2: "pose_landmarker_heavy.task",
    }

    def __init__(
        self,
        static_image_mode: bool = False,
        model_complexity: int = 1,
        min_detection_confidence: float = 0.5,
        min_tracking_confidence: float = 0.5,
        num_poses: int = 1,
    ):
        # Resolve model path
        model_dir = Path(__file__).resolve().parent.parent.parent / "models"
        model_file = self._MODEL_FILES.get(model_complexity, self._MODEL_FILES[0])
        model_path = model_dir / model_file

        if not model_path.exists():
            # Fall back to whichever model exists
            for complexity in [0, 1, 2]:
                fallback = model_dir / self._MODEL_FILES[complexity]
                if fallback.exists():
                    model_path = fallback
                    log.warning(
                        "pose_model_fallback",
                        requested=model_file,
                        using=fallback.name,
                    )
                    break
            else:
                raise FileNotFoundError(
                    f"No pose landmarker model found in {model_dir}. "
                    f"Download from https://developers.google.com/mediapipe/solutions/vision/pose_landmarker#models"
                )

        running_mode = RunningMode.IMAGE if static_image_mode else RunningMode.VIDEO

        options = PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(model_path)),
            running_mode=running_mode,
            num_poses=num_poses,
            min_pose_detection_confidence=min_detection_confidence,
            min_tracking_confidence=min_tracking_confidence,
            min_pose_presence_confidence=min_detection_confidence,
        )

        self.landmarker = PoseLandmarker.create_from_options(options)
        self._running_mode = running_mode
        self._static = static_image_mode
        self._frame_timestamp_ms = 0

        log.info(
            "pose_estimator_initialized",
            model=model_path.name,
            complexity=model_complexity,
            det_conf=min_detection_confidence,
            mode=running_mode.name,
        )

    def _landmarks_to_keypoints(self, landmarks) -> List[Dict]:
        """Convert a single MediaPipe pose's landmark list into our keypoint dicts."""
        keypoints = []
        for idx, landmark in enumerate(landmarks):
            kp = Keypoint(
                index=idx,
                name=self.LANDMARK_NAMES[idx] if idx < len(self.LANDMARK_NAMES) else f"landmark_{idx}",
                x=float(landmark.x),
                y=float(landmark.y),
                z=float(landmark.z),
                visibility=float(landmark.visibility),
            )
            keypoints.append(asdict(kp))
        return keypoints

    def _detect(self, rgb_frame: np.ndarray):
        """Run the landmarker and return the raw MediaPipe result."""
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
        if self._static:
            return self.landmarker.detect(mp_image)
        self._frame_timestamp_ms += 33  # ~30fps
        return self.landmarker.detect_for_video(mp_image, self._frame_timestamp_ms)

    def estimate(self, rgb_frame: np.ndarray) -> Optional[List[Dict]]:
        """Extract all 33 keypoints from an RGB frame.

        Args:
            rgb_frame: RGB image as numpy array (H, W, 3)

        Returns:
            List of 33 keypoint dicts for the first detected pose, or None if
            no person detected.
        """
        results = self._detect(rgb_frame)

        if not results.pose_landmarks or len(results.pose_landmarks) == 0:
            return None

        return self._landmarks_to_keypoints(results.pose_landmarks[0])

    @staticmethod
    def _compute_pose_bbox(kps: List[Dict], min_vis: float = 0.02) -> Optional[List[float]]:
        valid = [k for k in kps if k.get("visibility", 0) > min_vis]
        if len(valid) < 2:
            return None
        xs = [k["x"] for k in valid]
        ys = [k["y"] for k in valid]
        min_x = max(0.0, min(xs) - 0.04)
        min_y = max(0.0, min(ys) - 0.06)
        max_x = min(1.0, max(xs) + 0.04)
        max_y = min(1.0, max(ys) + 0.06)
        return [min_x, min_y, max_x, max_y]

    @staticmethod
    def _bbox_iou(boxA: List[float], boxB: List[float]) -> float:
        xA = max(boxA[0], boxB[0])
        yA = max(boxA[1], boxB[1])
        xB = min(boxA[2], boxB[2])
        yB = min(boxA[3], boxB[3])
        inter_w = max(0.0, xB - xA)
        inter_h = max(0.0, yB - yA)
        inter_area = inter_w * inter_h
        if inter_area <= 0:
            return 0.0
        boxAArea = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1])
        boxBArea = (boxB[2] - boxB[0]) * (boxB[3] - boxB[1])
        return inter_area / float(boxAArea + boxBArea - inter_area + 1e-6)

    @classmethod
    def filter_and_suppress_poses(
        cls,
        poses: List[List[Dict]],
        iou_threshold: float = 0.45,
        min_keypoints_vis: int = 2,
        min_vis_score: float = 0.04,
    ) -> List[List[Dict]]:
        """Filter out low-quality ghost poses and run Non-Maximum Suppression (NMS)
        to deduplicate multiple detections of the same physical person while preserving
        all distinct physical persons (including seated / upper-body portraits)."""
        if not poses:
            return []

        scored_poses = []
        for pose in poses:
            # Score this pose based on visibility of head (0..8), shoulders (11, 12), arms (13..16), or hips (23, 24)
            core_indices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 23, 24]
            vis_values = [pose[i]["visibility"] for i in core_indices if i < len(pose)]
            good_pts = sum(1 for v in vis_values if v >= min_vis_score)
            if good_pts < min_keypoints_vis:
                continue

            bbox = cls._compute_pose_bbox(pose, min_vis=0.02)
            if bbox is None:
                continue

            w = bbox[2] - bbox[0]
            h = bbox[3] - bbox[1]
            area = w * h
            if area < 0.002 or h < 0.025:
                continue

            avg_score = float(np.mean(vis_values)) if vis_values else 0.0
            cx = (bbox[0] + bbox[2]) / 2.0
            cy = (bbox[1] + bbox[3]) / 2.0
            scored_poses.append({
                "pose": pose,
                "bbox": bbox,
                "score": avg_score,
                "centroid": (cx, cy),
                "area": area,
            })

        if not scored_poses:
            return []

        scored_poses.sort(key=lambda p: p["score"], reverse=True)

        kept = []
        for candidate in scored_poses:
            should_suppress = False
            for existing in kept:
                iou = cls._bbox_iou(candidate["bbox"], existing["bbox"])
                c_dist = float(np.hypot(candidate["centroid"][0] - existing["centroid"][0],
                                        candidate["centroid"][1] - existing["centroid"][1]))

                if iou > iou_threshold or c_dist < 0.08:
                    should_suppress = True
                    break

            if not should_suppress:
                kept.append(candidate)

        return [k["pose"] for k in kept]

    def estimate_multi(self, rgb_frame: np.ndarray) -> List[List[Dict]]:
        """Extract keypoints for EVERY detected person in the frame with NMS deduplication.

        Returns:
            List of per-person keypoint lists. Empty list if nobody is detected.
        """
        results = self._detect(rgb_frame)
        if not results.pose_landmarks:
            return []
        raw_poses = [self._landmarks_to_keypoints(landmarks) for landmarks in results.pose_landmarks]
        return self.filter_and_suppress_poses(raw_poses)

    def get_body_keypoints(
        self, all_keypoints: List[Dict], min_visibility: float = 0.05
    ) -> Optional[Dict[str, Dict]]:
        """Extract the 12 body landmarks required for identification.

        Returns None if too many critical landmarks are not visible.
        """
        if all_keypoints is None:
            return None

        body_kps = {}
        low_visibility_count = 0

        for name, idx in self.BODY_LANDMARK_INDICES.items():
            kp = all_keypoints[idx]
            if kp["visibility"] < min_visibility:
                low_visibility_count += 1
            body_kps[name] = kp

        # Reject if almost all body landmarks are invisible, but allow seated /
        # upper-body people whose hips/legs are cut off by the desk or camera edge.
        shoulder_vis = body_kps["left_shoulder"]["visibility"] > min_visibility or body_kps["right_shoulder"]["visibility"] > min_visibility
        if low_visibility_count > 11 and not shoulder_vis:
            return None

        return body_kps

    def get_all_keypoints_dict(
        self, all_keypoints: List[Dict]
    ) -> Dict[str, Dict]:
        """Convert list of keypoints to name-indexed dictionary."""
        return {kp["name"]: kp for kp in all_keypoints}

    def draw_skeleton(
        self, bgr_frame: np.ndarray, rgb_frame: np.ndarray,
        cached_keypoints: Optional[List[Dict]] = None
    ) -> np.ndarray:
        """Draw skeleton overlay on BGR frame for visualization.

        If cached_keypoints is provided, draws without re-running pose estimation.
        """
        annotated = bgr_frame.copy()

        if cached_keypoints is not None:
            # Use cached keypoints to avoid running pose estimation again
            return self.draw_on_frame_with_results(annotated, cached_keypoints)

        # Re-run estimation and draw
        all_kps = self.estimate(rgb_frame)
        if all_kps:
            return self.draw_on_frame_with_results(annotated, all_kps)

        return annotated

    def draw_on_frame_with_results(
        self, bgr_frame: np.ndarray, all_keypoints: List[Dict]
    ) -> np.ndarray:
        """Draw keypoints on frame without re-running pose estimation."""
        annotated = bgr_frame.copy()
        h, w = annotated.shape[:2]

        # Draw connections first (behind dots)
        connections = [
            (11, 13), (13, 15), (12, 14), (14, 16),  # Arms
            (11, 12), (23, 24),  # Shoulders, Hips
            (11, 23), (12, 24),  # Torso
            (23, 25), (25, 27), (24, 26), (26, 28),  # Legs
            (0, 11), (0, 12),  # Head to shoulders
        ]
        for start, end in connections:
            if start < len(all_keypoints) and end < len(all_keypoints):
                kp1, kp2 = all_keypoints[start], all_keypoints[end]
                if kp1["visibility"] > 0.05 and kp2["visibility"] > 0.05:
                    p1 = (int(kp1["x"] * w), int(kp1["y"] * h))
                    p2 = (int(kp2["x"] * w), int(kp2["y"] * h))
                    cv2.line(annotated, p1, p2, (0, 200, 255), 2)

        # Draw keypoints
        for kp in all_keypoints:
            if kp["visibility"] > 0.05:
                cx = int(kp["x"] * w)
                cy = int(kp["y"] * h)
                cv2.circle(annotated, (cx, cy), 4, (0, 255, 0), -1)

        return annotated

    def close(self):
        """Release MediaPipe resources."""
        self.landmarker.close()
        log.info("pose_estimator_closed")

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
