"""
services/feature_extraction/quality.py
Quality assessment and anatomical plausibility checks for skeleton keypoints.

Supports both full-body and seated/upper-body webcam framing without rejecting
seated individuals or close portrait shots.
"""
import numpy as np
import structlog
from typing import Dict, Tuple, Optional, List

log = structlog.get_logger()


class SkeletonQualityChecker:
    """Evaluates the anatomical quality and plausibility of extracted skeleton keypoints."""

    CORE_SHOULDERS = ["left_shoulder", "right_shoulder"]
    MIN_SHOULDER_VISIBILITY = 0.10

    @classmethod
    def evaluate_quality(
        cls, keypoints: Dict[str, Dict]
    ) -> Tuple[bool, float, Optional[str]]:
        """Evaluate keypoints for usability in biometric identification.

        Returns:
            (is_valid, quality_score, rejection_reason)
        """
        if not keypoints:
            return False, 0.0, "No skeleton keypoints provided"

        # 1. Core check: shoulders must be present
        if "left_shoulder" not in keypoints or "right_shoulder" not in keypoints:
            return False, 0.0, "Shoulders not detected"

        l_sh_vis = float(keypoints["left_shoulder"].get("visibility", 0.0))
        r_sh_vis = float(keypoints["right_shoulder"].get("visibility", 0.0))

        if l_sh_vis < cls.MIN_SHOULDER_VISIBILITY and r_sh_vis < cls.MIN_SHOULDER_VISIBILITY:
            return False, 0.0, "Shoulders obscured or low visibility"

        # 2. Check shoulder physical span (ensure person is not a tiny speck or collapsed)
        l_sh = np.array([keypoints["left_shoulder"].get("x", 0.0), keypoints["left_shoulder"].get("y", 0.0)], dtype=np.float64)
        r_sh = np.array([keypoints["right_shoulder"].get("x", 0.0), keypoints["right_shoulder"].get("y", 0.0)], dtype=np.float64)
        shoulder_w = float(np.linalg.norm(l_sh - r_sh))

        if shoulder_w < 0.02:
            return False, 0.0, "Skeleton span too small (subject too far)"

        # 3. Compute overall visibility score across available landmarks
        vis_list = [float(kp.get("visibility", 0.0)) for kp in keypoints.values() if isinstance(kp, dict)]
        avg_vis = float(np.mean(vis_list)) if vis_list else 0.5

        quality_score = min(max(avg_vis, 0.20), 1.0)
        return True, quality_score, None
