"""
services/feature_extraction/static_features.py
Compute 100% scale-invariant, distance-invariant static skeletal biometric features:
  - 12 Normalized Limb Segment Lengths (normalized by invariant trunk scale)
  - 8 Normalized Joint Angles (normalized to 0..1 scale)
  - 8 Anthropometric Body Proportions & Segment Ratios
  - 6 Invariant Morphological Metrics (wingspan, aspect ratios, etc.)
  - 6 Relative Centroid Joint Distances
Total: 40 scale-invariant features
"""
import numpy as np
import structlog
from typing import Dict, List, Optional

log = structlog.get_logger()


class StaticFeatureExtractor:
    """Extracts scale-invariant and distance-invariant biometric features from skeleton keypoints."""

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

    # ── Angle definitions: (point_a, vertex, point_b) ────────────────────────
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

    @staticmethod
    def _get_coords(keypoints: Dict[str, Dict], name: str) -> np.ndarray:
        """Extract (x, y, z) coordinates from a named keypoint."""
        kp = keypoints[name]
        return np.array([kp.get("x", 0.0), kp.get("y", 0.0), kp.get("z", 0.0)], dtype=np.float64)

    @staticmethod
    def _distance(p1: np.ndarray, p2: np.ndarray) -> float:
        """3D Euclidean distance."""
        return float(np.linalg.norm(p1 - p2))

    @staticmethod
    def _angle(a: np.ndarray, vertex: np.ndarray, b: np.ndarray) -> float:
        """Angle at vertex between vectors (vertex→a) and (vertex→b) in degrees [0, 180]."""
        v1 = a - vertex
        v2 = b - vertex
        denom = (np.linalg.norm(v1) * np.linalg.norm(v2)) + 1e-8
        cos_a = np.dot(v1, v2) / denom
        cos_a = np.clip(cos_a, -1.0, 1.0)
        return float(np.degrees(np.arccos(cos_a)))

    def compute_limb_lengths(self, kps: Dict[str, Dict]) -> Dict[str, float]:
        """Compute raw 3D limb lengths."""
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
        """Compute all 8 joint angles in degrees."""
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
        """Average of left and right torso side lengths."""
        if "left_shoulder" not in kps or "left_hip" not in kps:
            return 0.25
        left = self._distance(self._get_coords(kps, "left_shoulder"), self._get_coords(kps, "left_hip"))
        right = self._distance(self._get_coords(kps, "right_shoulder"), self._get_coords(kps, "right_hip"))
        return max((left + right) / 2.0, 0.01)

    def extract_all(self, kps: Dict[str, Dict]) -> Optional[Dict[str, float]]:
        """Extract the complete 40-dimensional scale-invariant biometric feature dictionary.

        Returns None if extraction fails or critical joints are missing.
        """
        try:
            limbs = self.compute_limb_lengths(kps)
            angles = self.compute_joint_angles(kps)
            torso = self.compute_torso_length(kps)

            # Invariant trunk reference scale: L_ref = sqrt(torso^2 + shoulder_width^2)
            shoulder_w = limbs.get("shoulder_width", 0.15)
            hip_w = max(limbs.get("hip_width", 0.12), 0.01)
            l_ref = max(np.sqrt(torso ** 2 + shoulder_w ** 2), 0.05)

            # Leg & arm aggregates
            left_leg = limbs.get("left_thigh", 0.0) + limbs.get("left_shin", 0.0)
            right_leg = limbs.get("right_thigh", 0.0) + limbs.get("right_shin", 0.0)
            avg_leg = max((left_leg + right_leg) / 2.0, 0.05)

            left_arm = limbs.get("left_upper_arm", 0.0) + limbs.get("left_forearm", 0.0)
            right_arm = limbs.get("right_upper_arm", 0.0) + limbs.get("right_forearm", 0.0)
            avg_arm = max((left_arm + right_arm) / 2.0, 0.05)

            avg_upper_arm = max((limbs.get("left_upper_arm", 0.0) + limbs.get("right_upper_arm", 0.0)) / 2.0, 0.01)
            avg_forearm = max((limbs.get("left_forearm", 0.0) + limbs.get("right_forearm", 0.0)) / 2.0, 0.01)
            avg_thigh = max((limbs.get("left_thigh", 0.0) + limbs.get("right_thigh", 0.0)) / 2.0, 0.01)
            avg_shin = max((limbs.get("left_shin", 0.0) + limbs.get("right_shin", 0.0)) / 2.0, 0.01)

            features = {}

            # 1. 12 Normalized Limb Lengths (normalized by L_ref)
            for k in self.LIMB_DEFINITIONS:
                features[f"{k}_norm"] = limbs.get(k, 0.0) / l_ref

            # 2. 8 Normalized Joint Angles (scaled to [0, 1])
            for k, deg in angles.items():
                features[f"{k}_norm"] = float(deg) / 180.0

            # 3. 8 Core Biometric Proportions
            features["torso_to_leg_ratio"] = torso / (avg_leg + 1e-6)
            features["arm_to_torso_ratio"] = avg_arm / (torso + 1e-6)
            features["shoulder_to_hip_ratio"] = shoulder_w / (hip_w + 1e-6)
            features["upper_to_lower_arm_ratio"] = avg_upper_arm / (avg_forearm + 1e-6)
            features["thigh_to_shin_ratio"] = avg_thigh / (avg_shin + 1e-6)
            features["arm_to_leg_ratio"] = avg_arm / (avg_leg + 1e-6)
            features["left_right_arm_symmetry"] = (left_arm + 1e-4) / (right_arm + 1e-4)
            features["left_right_leg_symmetry"] = (left_leg + 1e-4) / (right_leg + 1e-4)

            # 4. 6 Invariant Morphological Metrics
            height_est = torso + avg_leg
            features["upper_to_lower_body_ratio"] = (torso + avg_arm) / (avg_leg + 1e-6)
            features["torso_aspect_ratio"] = torso / (shoulder_w + 1e-6)
            features["pelvis_to_torso_ratio"] = hip_w / (torso + 1e-6)
            features["wingspan_to_height_ratio"] = (2.0 * avg_arm + shoulder_w) / (height_est + 1e-6)
            features["left_limb_to_height_ratio"] = left_leg / (height_est + 1e-6)
            features["right_limb_to_height_ratio"] = right_leg / (height_est + 1e-6)

            # 5. 6 Scale-Invariant Centroid Relative Joint Distances
            # Center reference: mid-hip
            if "left_hip" in kps and "right_hip" in kps:
                hip_center = (self._get_coords(kps, "left_hip") + self._get_coords(kps, "right_hip")) / 2.0
            else:
                hip_center = np.array([0.5, 0.5, 0.0])

            def get_rel_dist(pt_name):
                if pt_name in kps:
                    return float(np.linalg.norm(self._get_coords(kps, pt_name) - hip_center)) / l_ref
                return 0.5

            features["rel_left_wrist_dist"] = get_rel_dist("left_wrist")
            features["rel_right_wrist_dist"] = get_rel_dist("right_wrist")
            features["rel_left_elbow_dist"] = get_rel_dist("left_elbow")
            features["rel_right_elbow_dist"] = get_rel_dist("right_elbow")
            features["rel_left_ankle_dist"] = get_rel_dist("left_ankle")
            features["rel_right_ankle_dist"] = get_rel_dist("right_ankle")

            return features

        except Exception as e:
            log.warning("static_feature_extraction_failed", error=str(e))
            return None

    ALL_FEATURE_KEYS = sorted([
        # 12 Normalized Limb Lengths
        "left_upper_arm_norm", "left_forearm_norm", "right_upper_arm_norm", "right_forearm_norm",
        "shoulder_width_norm", "left_torso_norm", "right_torso_norm", "hip_width_norm",
        "left_thigh_norm", "left_shin_norm", "right_thigh_norm", "right_shin_norm",
        # 8 Normalized Angles
        "left_elbow_angle_norm", "right_elbow_angle_norm", "left_shoulder_angle_norm", "right_shoulder_angle_norm",
        "left_hip_angle_norm", "right_hip_angle_norm", "left_knee_angle_norm", "right_knee_angle_norm",
        # 8 Proportions & Symmetry
        "torso_to_leg_ratio", "arm_to_torso_ratio", "shoulder_to_hip_ratio", "upper_to_lower_arm_ratio",
        "thigh_to_shin_ratio", "arm_to_leg_ratio", "left_right_arm_symmetry", "left_right_leg_symmetry",
        # 6 Morphological
        "upper_to_lower_body_ratio", "torso_aspect_ratio", "pelvis_to_torso_ratio",
        "wingspan_to_height_ratio", "left_limb_to_height_ratio", "right_limb_to_height_ratio",
        # 6 Centroid Distances
        "rel_left_wrist_dist", "rel_right_wrist_dist", "rel_left_elbow_dist",
        "rel_right_elbow_dist", "rel_left_ankle_dist", "rel_right_ankle_dist",
    ])

    def to_vector(self, features: Dict[str, float]) -> np.ndarray:
        """Convert feature dict → ordered numpy vector (consistent ordering)."""
        return np.array(
            [float(features.get(k, 0.0)) for k in self.ALL_FEATURE_KEYS], dtype=np.float64
        )

    def get_feature_names(self) -> List[str]:
        """Return the ordered feature names matching to_vector() output."""
        return list(self.ALL_FEATURE_KEYS)

    @staticmethod
    def smooth_features(
        current: Dict[str, float],
        previous: Optional[Dict[str, float]],
        alpha: float = 0.3,
    ) -> Dict[str, float]:
        """Exponential moving average smoothing across frames."""
        if previous is None:
            return current
        smoothed = {}
        for k in current:
            if k in previous:
                smoothed[k] = alpha * current[k] + (1 - alpha) * previous[k]
            else:
                smoothed[k] = current[k]
        return smoothed
