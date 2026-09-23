"""
services/feature_extraction/static_features.py
Anthropometric Biometric Feature Extractor.

Extracts translation-invariant and distance-invariant biological body proportions
from MediaPipe 3D skeleton keypoints.

Measurements are taken from MediaPipe's *world* landmarks (metres, mid-hip origin),
never from the image-normalized landmarks. Image landmarks are a perspective
projection: their apparent limb lengths are determined by where the subject stands,
how far they are from the lens, and the frame aspect ratio. Two different people
standing on the same spot in the same pose therefore project to nearly identical
image-space skeletons, and any template built from them collapses onto the same
point in feature space.

The vector combines two complementary groups:
  * shape  — scale-free proportions/indices (who has long forearms for their torso)
  * size   — absolute metric body dimensions (who is actually the broader person)

Absolute size is the strongest single discriminator between two people in the same
pose, so it is only populated when true world coordinates are present; with image
coordinates it would encode camera distance instead of body size and is zeroed out.
"""
import numpy as np
import structlog
from typing import Dict, List, Optional, Any

from .quality import SkeletonQualityChecker

log = structlog.get_logger()


class StaticFeatureExtractor:
    """Extracts pure anthropometric biological invariants from 3D skeleton keypoints."""

    # ── Feature Versioning ────────────────────────────────────────────────────
    # Bumped from v2.0_anthropometric: measurements moved from image-normalized
    # landmarks to metric world landmarks and absolute size features were added.
    # v2.0 profiles are not comparable and are rejected at template load time.
    FEATURE_VERSION = "v3.0_world_metric"

    # ── Limb definitions: (start_landmark, end_landmark) ──────────────────────
    LIMB_DEFINITIONS = {
        "left_upper_arm": ("left_shoulder", "left_elbow"),
        "left_forearm": ("left_elbow", "left_wrist"),
        "right_upper_arm": ("right_shoulder", "right_elbow"),
        "right_forearm": ("right_elbow", "right_wrist"),
        "shoulder_width": ("left_shoulder", "right_shoulder"),
        "left_torso": ("left_shoulder", "left_hip"),
        "right_torso": ("right_shoulder", "right_hip"),
        "hip_width": ("left_hip", "right_hip"),
        "left_thigh": ("left_hip", "left_knee"),
        "left_shin": ("left_knee", "left_ankle"),
        "right_thigh": ("right_hip", "right_knee"),
        "right_shin": ("right_knee", "right_ankle"),
    }

    # ── Angle definitions (secondary metrics only, not in primary biometric vector) ──
    ANGLE_DEFINITIONS = {
        "left_elbow_angle": ("left_shoulder", "left_elbow", "left_wrist"),
        "right_elbow_angle": ("right_shoulder", "right_elbow", "right_wrist"),
        "left_shoulder_angle": ("left_elbow", "left_shoulder", "left_hip"),
        "right_shoulder_angle": ("right_elbow", "right_shoulder", "right_hip"),
        "left_hip_angle": ("left_shoulder", "left_hip", "left_knee"),
        "right_hip_angle": ("right_shoulder", "right_hip", "right_knee"),
        "left_knee_angle": ("left_hip", "left_knee", "left_ankle"),
        "right_knee_angle": ("right_hip", "right_knee", "right_ankle"),
    }

    # ── Absolute metric body dimensions (metres, world coordinates only) ──────
    # These carry overall body size, which pure ratios deliberately throw away.
    # Two people with similar proportions but different builds separate here.
    METRIC_SCALE_FEATURE_KEYS = [
        "shoulder_width_m",
        "trunk_scale_m",
        "arm_length_m",
        "leg_length_m",
        "stature_est_m",
    ]

    # ── Scale-free proportion features ────────────────────────────────────────
    SHAPE_FEATURE_KEYS = sorted([
        # 12 Normalized Limb Segment Lengths (normalized by invariant trunk scale L_ref)
        "shoulder_width_norm",
        "hip_width_norm",
        "torso_length_norm",
        "left_upper_arm_norm",
        "right_upper_arm_norm",
        "left_forearm_norm",
        "right_forearm_norm",
        "left_thigh_norm",
        "right_thigh_norm",
        "left_shin_norm",
        "right_shin_norm",
        "total_leg_norm",
        "total_arm_norm",
        # 11 Core Biological Proportions & Invariant Indices
        "shoulder_to_hip_ratio",      # Biacromial-to-Bicristal index (varies 20-40% across builds)
        "torso_to_leg_ratio",          # Sitting height ratio
        "brachial_index",              # Forearm to upper arm ratio
        "crural_index",                # Shin to thigh ratio
        "arm_to_leg_ratio",            # Intermembral index component
        "arm_to_torso_ratio",
        "wingspan_to_height_ratio",    # Relative wingspan
        "upper_to_lower_body_ratio",
        "torso_aspect_ratio",          # Torso length vs shoulder breadth
        "pelvis_to_torso_ratio",
        "left_right_arm_symmetry",     # Left-to-right arm symmetry
    ])

    # Full ordered biometric vector (shape + size).
    ANTHROPOMETRIC_FEATURE_KEYS = sorted(SHAPE_FEATURE_KEYS + METRIC_SCALE_FEATURE_KEYS)

    ALL_FEATURE_KEYS = ANTHROPOMETRIC_FEATURE_KEYS

    def __init__(self):
        self._warned_no_world = False

    @staticmethod
    def has_world_coords(keypoints: Dict[str, Dict]) -> bool:
        """True when the keypoints carry MediaPipe world (metric) coordinates."""
        return any(
            isinstance(kp, dict) and kp.get("has_world") for kp in keypoints.values()
        )

    @staticmethod
    def _get_coords(keypoints: Dict[str, Dict], name: str) -> np.ndarray:
        """Extract 3D coordinates from a named landmark.

        Prefers metric world coordinates; falls back to image-normalized ones only
        when the upstream estimator did not supply world landmarks.
        """
        kp = keypoints[name]
        if kp.get("has_world"):
            return np.array(
                [kp.get("wx", 0.0), kp.get("wy", 0.0), kp.get("wz", 0.0)], dtype=np.float64
            )
        return np.array([kp.get("x", 0.0), kp.get("y", 0.0), kp.get("z", 0.0)], dtype=np.float64)

    @staticmethod
    def _distance(p1: np.ndarray, p2: np.ndarray) -> float:
        """3D Euclidean distance between two landmark points."""
        return float(np.linalg.norm(p1 - p2))

    @staticmethod
    def _angle(a: np.ndarray, vertex: np.ndarray, b: np.ndarray) -> float:
        """Angle at vertex in degrees [0, 180]."""
        v1 = a - vertex
        v2 = b - vertex
        denom = (np.linalg.norm(v1) * np.linalg.norm(v2)) + 1e-8
        cos_a = np.dot(v1, v2) / denom
        cos_a = np.clip(cos_a, -1.0, 1.0)
        return float(np.degrees(np.arccos(cos_a)))

    def compute_limb_lengths(self, kps: Dict[str, Dict]) -> Dict[str, float]:
        """Compute 3D limb lengths."""
        lengths = {}
        for name, (start, end) in self.LIMB_DEFINITIONS.items():
            if start in kps and end in kps:
                p1 = self._get_coords(kps, start)
                p2 = self._get_coords(kps, end)
                lengths[name] = self._distance(p1, p2)
            else:
                lengths[name] = 0.0
        return lengths

    def compute_joint_angles(self, kps: Dict[str, Dict]) -> Dict[str, float]:
        """Compute 8 joint angles in degrees (for temporal gait/posture analysis)."""
        angles = {}
        for name, (a, v, b) in self.ANGLE_DEFINITIONS.items():
            if a in kps and v in kps and b in kps:
                pa = self._get_coords(kps, a)
                pv = self._get_coords(kps, v)
                pb = self._get_coords(kps, b)
                angles[name] = self._angle(pa, pv, pb)
            else:
                angles[name] = 90.0
        return angles

    def compute_torso_length(self, kps: Dict[str, Dict]) -> float:
        """Torso length calculated as average of left and right torso sides."""
        if "left_shoulder" not in kps or "left_hip" not in kps:
            return 0.45
        left = self._distance(self._get_coords(kps, "left_shoulder"), self._get_coords(kps, "left_hip"))
        right = self._distance(self._get_coords(kps, "right_shoulder"), self._get_coords(kps, "right_hip"))
        return max((left + right) / 2.0, 0.01)

    def extract_all(self, kps: Dict[str, Dict]) -> Optional[Dict[str, float]]:
        """Extract the complete 24-dimensional pure anthropometric invariant feature dictionary.

        Performs quality filtering first and returns None if skeleton quality is insufficient.
        """
        is_valid, quality_score, reason = SkeletonQualityChecker.evaluate_quality(kps)
        if not is_valid:
            log.debug("frame_quality_rejected", reason=reason, score=quality_score)
            return None

        try:
            has_world = self.has_world_coords(kps)
            if not has_world and not self._warned_no_world:
                # Once per extractor — this runs on every frame of every stream.
                self._warned_no_world = True
                log.warning(
                    "static_features_missing_world_landmarks",
                    detail="Falling back to image-normalized coordinates; absolute size "
                           "features are disabled and discrimination is reduced.",
                )

            limbs = self.compute_limb_lengths(kps)

            # Shoulder width
            shoulder_w = limbs.get("shoulder_width", 0.0)
            if shoulder_w <= 0.01:
                if "left_shoulder" in kps and "right_shoulder" in kps:
                    shoulder_w = self._distance(self._get_coords(kps, "left_shoulder"), self._get_coords(kps, "right_shoulder"))
                else:
                    shoulder_w = 0.36 if has_world else 0.20
            shoulder_w = max(shoulder_w, 0.03)

            # Torso length
            torso = self.compute_torso_length(kps)
            if torso <= 0.02:
                torso = shoulder_w * 1.35

            # Hip width
            hip_w = limbs.get("hip_width", 0.0)
            if hip_w <= 0.01:
                hip_w = shoulder_w * 0.76

            # Invariant trunk reference scale: L_ref = sqrt(torso^2 + shoulder_width^2)
            l_ref = max(np.sqrt(torso ** 2 + shoulder_w ** 2), 0.04)

            # Arms
            l_ua = limbs.get("left_upper_arm", 0.0)
            r_ua = limbs.get("right_upper_arm", 0.0)
            l_fa = limbs.get("left_forearm", 0.0)
            r_fa = limbs.get("right_forearm", 0.0)

            left_arm = l_ua + l_fa
            right_arm = r_ua + r_fa
            if left_arm <= 0.01 and right_arm <= 0.01:
                left_arm = right_arm = shoulder_w * 1.40
                l_ua = r_ua = left_arm * 0.52
                l_fa = r_fa = left_arm * 0.48
            elif left_arm <= 0.01:
                left_arm = right_arm
                l_ua = r_ua
                l_fa = r_fa
            elif right_arm <= 0.01:
                right_arm = left_arm
                r_ua = l_ua
                r_fa = l_fa

            avg_arm = max((left_arm + right_arm) / 2.0, 0.04)
            avg_upper_arm = max((l_ua + r_ua) / 2.0, 0.01)
            avg_forearm = max((l_fa + r_fa) / 2.0, 0.01)

            # Legs (handled gracefully for seated/webcam users)
            l_thigh = limbs.get("left_thigh", 0.0)
            r_thigh = limbs.get("right_thigh", 0.0)
            l_shin = limbs.get("left_shin", 0.0)
            r_shin = limbs.get("right_shin", 0.0)

            left_leg = l_thigh + l_shin
            right_leg = r_thigh + r_shin
            if left_leg <= 0.01 and right_leg <= 0.01:
                left_leg = right_leg = torso * 1.75
                l_thigh = r_thigh = left_leg * 0.52
                l_shin = r_shin = left_leg * 0.48
            elif left_leg <= 0.01:
                left_leg = right_leg
                l_thigh = r_thigh
                l_shin = r_shin
            elif right_leg <= 0.01:
                right_leg = left_leg
                r_thigh = l_thigh
                r_shin = l_shin

            avg_leg = max((left_leg + right_leg) / 2.0, 0.04)
            avg_thigh = max((l_thigh + r_thigh) / 2.0, 0.01)
            avg_shin = max((l_shin + r_shin) / 2.0, 0.01)

            height_est = torso + avg_leg

            features = {}

            # 1. 13 Normalized Segment Lengths (normalized by L_ref)
            features["shoulder_width_norm"] = shoulder_w / l_ref
            features["hip_width_norm"] = hip_w / l_ref
            features["torso_length_norm"] = torso / l_ref
            features["left_upper_arm_norm"] = l_ua / l_ref
            features["right_upper_arm_norm"] = r_ua / l_ref
            features["left_forearm_norm"] = l_fa / l_ref
            features["right_forearm_norm"] = r_fa / l_ref
            features["left_thigh_norm"] = l_thigh / l_ref
            features["right_thigh_norm"] = r_thigh / l_ref
            features["left_shin_norm"] = l_shin / l_ref
            features["right_shin_norm"] = r_shin / l_ref
            features["total_leg_norm"] = avg_leg / l_ref
            features["total_arm_norm"] = avg_arm / l_ref

            # 2. 11 Core Biological Proportions & Indices (immune to standing pose)
            features["shoulder_to_hip_ratio"] = shoulder_w / (hip_w + 1e-6)
            features["torso_to_leg_ratio"] = torso / (avg_leg + 1e-6)
            features["brachial_index"] = avg_forearm / (avg_upper_arm + 1e-6)
            features["crural_index"] = avg_shin / (avg_thigh + 1e-6)
            features["arm_to_leg_ratio"] = avg_arm / (avg_leg + 1e-6)
            features["arm_to_torso_ratio"] = avg_arm / (torso + 1e-6)
            features["wingspan_to_height_ratio"] = (2.0 * avg_arm + shoulder_w) / (height_est + 1e-6)
            features["upper_to_lower_body_ratio"] = (torso + avg_arm) / (avg_leg + 1e-6)
            features["torso_aspect_ratio"] = torso / (shoulder_w + 1e-6)
            features["pelvis_to_torso_ratio"] = hip_w / (torso + 1e-6)
            features["left_right_arm_symmetry"] = (left_arm + 1e-6) / (right_arm + 1e-6)

            # 3. 5 Absolute Metric Body Dimensions (world coordinates only)
            # Ratios alone cannot separate two similarly-proportioned people; raw
            # body size can. With image coordinates these numbers would track the
            # subject's distance from the camera rather than their build, so they
            # are zeroed out and contribute nothing to the match distance.
            if has_world:
                features["shoulder_width_m"] = shoulder_w
                features["trunk_scale_m"] = l_ref
                features["arm_length_m"] = avg_arm
                features["leg_length_m"] = avg_leg
                features["stature_est_m"] = height_est
            else:
                for k in self.METRIC_SCALE_FEATURE_KEYS:
                    features[k] = 0.0

            return features

        except Exception as e:
            log.warning("static_feature_extraction_failed", error=str(e))
            return None

    def to_vector(self, features: Dict[str, float]) -> np.ndarray:
        """Convert feature dict to ordered numpy array."""
        return np.array(
            [float(features.get(k, 0.0)) for k in self.ANTHROPOMETRIC_FEATURE_KEYS],
            dtype=np.float64,
        )

    def get_feature_names(self) -> List[str]:
        return list(self.ANTHROPOMETRIC_FEATURE_KEYS)

    @classmethod
    def normalize_vector(cls, v: Any) -> np.ndarray:
        """Coerce a stored vector to a numpy array without reinterpreting it.

        Vectors of a different length come from an older feature version and are
        returned unchanged so callers reject them on the length check. Truncating
        them would silently align unrelated features onto each other and hand the
        matcher meaningless coordinates.
        """
        return np.array(v, dtype=np.float64)
