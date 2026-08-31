"""
services/feature_extraction/static_features.py
Anthropometric Biometric Feature Extractor.

Extracts 100% scale-invariant, translation-invariant, and distance-invariant
biological body proportions from MediaPipe 3D skeleton keypoints.

Transient standing pose angles are strictly excluded from the biometric identity vector
so that two different individuals standing in the exact same pose are differentiated
purely by their internal biological skeletal proportions.
"""
import numpy as np
import structlog
from typing import Dict, List, Optional, Any

from .quality import SkeletonQualityChecker

log = structlog.get_logger()


class StaticFeatureExtractor:
    """Extracts pure anthropometric biological invariants from 3D skeleton keypoints."""

    # ── Feature Versioning ────────────────────────────────────────────────────
    FEATURE_VERSION = "v2.0_anthropometric"

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

    # ── 24 Pure Anthropometric Invariant Features ─────────────────────────────
    ANTHROPOMETRIC_FEATURE_KEYS = sorted([
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

    ALL_FEATURE_KEYS = ANTHROPOMETRIC_FEATURE_KEYS

    @staticmethod
    def _get_coords(keypoints: Dict[str, Dict], name: str) -> np.ndarray:
        """Extract (x, y, z) coordinates from named landmark."""
        kp = keypoints[name]
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
            return 0.25
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
            limbs = self.compute_limb_lengths(kps)
            
            # Shoulder width
            shoulder_w = limbs.get("shoulder_width", 0.0)
            if shoulder_w <= 0.01:
                if "left_shoulder" in kps and "right_shoulder" in kps:
                    shoulder_w = self._distance(self._get_coords(kps, "left_shoulder"), self._get_coords(kps, "right_shoulder"))
                else:
                    shoulder_w = 0.20
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
        """Ensure feature vector is of the standard 24-dim format."""
        arr = np.array(v, dtype=np.float64)
        if len(arr) == len(cls.ANTHROPOMETRIC_FEATURE_KEYS):
            return arr
        # Handle legacy 40-dim vectors by mapping existing keys
        if len(arr) == 40:
            # Map legacy 40-dim to 24-dim
            # Truncate or map appropriately
            return arr[:len(cls.ANTHROPOMETRIC_FEATURE_KEYS)]
        return arr
