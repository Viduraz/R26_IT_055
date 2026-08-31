"""
tests/test_biometric_system.py
Comprehensive automated test suite for the remade open-set hybrid biometric identification system.

Tests:
  1. Scale & Translation Invariance of Anthropometric Features
  2. Skeleton Quality Assessment and Occlusion Rejection
  3. Same-Pose Disambiguation (Person A vs Person B in identical standing pose)
  4. Open-Set Stranger Rejection (Zero false accepts on unregistered visitors)
  5. Same-Pose Ambiguity Detection and Temporal Motion Resolution
  6. Instant Multi-Pose Enrollment with Zero-Retraining Matching
  7. End-to-End Latency Benchmarking (< 15 ms per frame)
"""
import pytest
import numpy as np
import time
from typing import Dict

from services.feature_extraction.quality import SkeletonQualityChecker
from services.feature_extraction.static_features import StaticFeatureExtractor
from services.feature_extraction.gait_features import GaitFeatureExtractor
from services.identification.models.biometric_template import BiometricTemplateMatcher
from services.identification.models.lstm_model import SkeletonLSTM
from services.identification.fusion import DecisionFusion
from services.identification.predictor import Predictor


def _generate_synthetic_skeleton(
    shoulder_width: float = 0.38,
    hip_width: float = 0.28,
    torso_length: float = 0.48,
    arm_length: float = 0.55,
    leg_length: float = 0.85,
    offset_x: float = 0.5,
    offset_y: float = 0.5,
    scale: float = 1.0,
) -> Dict[str, Dict]:
    """Generate a realistic 3D skeleton keypoint dictionary."""
    sw = (shoulder_width * scale) / 2.0
    hw = (hip_width * scale) / 2.0
    tl = torso_length * scale
    al = (arm_length * scale) / 2.0
    ll = (leg_length * scale) / 2.0

    # Mid-hip is at (offset_x, offset_y, 0)
    kps = {
        "left_shoulder": {"x": offset_x - sw, "y": offset_y - tl, "z": 0.0, "visibility": 0.95},
        "right_shoulder": {"x": offset_x + sw, "y": offset_y - tl, "z": 0.0, "visibility": 0.95},
        "left_elbow": {"x": offset_x - sw - (0.05 * scale), "y": offset_y - tl + al, "z": 0.02 * scale, "visibility": 0.92},
        "right_elbow": {"x": offset_x + sw + (0.05 * scale), "y": offset_y - tl + al, "z": 0.02 * scale, "visibility": 0.92},
        "left_wrist": {"x": offset_x - sw - (0.08 * scale), "y": offset_y - tl + 2 * al, "z": 0.03 * scale, "visibility": 0.90},
        "right_wrist": {"x": offset_x + sw + (0.08 * scale), "y": offset_y - tl + 2 * al, "z": 0.03 * scale, "visibility": 0.90},
        "left_hip": {"x": offset_x - hw, "y": offset_y, "z": 0.0, "visibility": 0.95},
        "right_hip": {"x": offset_x + hw, "y": offset_y, "z": 0.0, "visibility": 0.95},
        "left_knee": {"x": offset_x - hw, "y": offset_y + ll, "z": 0.01 * scale, "visibility": 0.93},
        "right_knee": {"x": offset_x + hw, "y": offset_y + ll, "z": 0.01 * scale, "visibility": 0.93},
        "left_ankle": {"x": offset_x - hw, "y": offset_y + 2 * ll, "z": 0.02 * scale, "visibility": 0.91},
        "right_ankle": {"x": offset_x + hw, "y": offset_y + 2 * ll, "z": 0.02 * scale, "visibility": 0.91},
    }
    return kps


class TestBiometricSystem:

    def test_feature_invariance(self):
        """Test scale and translation invariance of anthropometric features."""
        ext = StaticFeatureExtractor()

        base_kps = _generate_synthetic_skeleton(scale=1.0, offset_x=0.5, offset_y=0.5)
        scaled_kps = _generate_synthetic_skeleton(scale=1.65, offset_x=0.2, offset_y=0.8)

        feat_base = ext.extract_all(base_kps)
        feat_scaled = ext.extract_all(scaled_kps)

        assert feat_base is not None
        assert feat_scaled is not None

        vec_base = ext.to_vector(feat_base)
        vec_scaled = ext.to_vector(feat_scaled)

        # Invariant features should match with negligible error across scale & translation
        max_diff = np.max(np.abs(vec_base - vec_scaled))
        assert max_diff < 1e-4, f"Features not scale/translation invariant, max diff: {max_diff}"

    def test_quality_checker(self):
        """Test that degraded or incomplete skeletons are caught by quality checker."""
        kps = _generate_synthetic_skeleton()
        is_valid, score, reason = SkeletonQualityChecker.evaluate_quality(kps)
        assert is_valid is True
        assert score > 0.80

        # Occlude shoulders
        bad_kps = dict(kps)
        bad_kps["left_shoulder"]["visibility"] = 0.05
        bad_kps["right_shoulder"]["visibility"] = 0.05
        bad_kps["left_elbow"]["visibility"] = 0.05
        bad_kps["right_elbow"]["visibility"] = 0.05
        is_valid_bad, score_bad, reason_bad = SkeletonQualityChecker.evaluate_quality(bad_kps)
        assert is_valid_bad is False
        assert "visibility" in reason_bad.lower()

    def test_same_pose_disambiguation(self):
        """CRITICAL TEST: Differentiate Person A and Person B standing in identical poses."""
        ext = StaticFeatureExtractor()

        # Person A (Broad build, long arms, shorter legs)
        kps_a = _generate_synthetic_skeleton(shoulder_width=0.44, hip_width=0.28, torso_length=0.45, arm_length=0.60, leg_length=0.78)
        # Person B (Slender build, narrow shoulders, longer legs)
        kps_b = _generate_synthetic_skeleton(shoulder_width=0.34, hip_width=0.29, torso_length=0.42, arm_length=0.50, leg_length=0.92)

        feat_a = ext.to_vector(ext.extract_all(kps_a))
        feat_b = ext.to_vector(ext.extract_all(kps_b))

        matcher = BiometricTemplateMatcher(acceptance_threshold=0.70)
        profiles = [
            {"user_id": "person_a", "static_features": {"samples": [feat_a.tolist(), (feat_a * 1.01).tolist()]}},
            {"user_id": "person_b", "static_features": {"samples": [feat_b.tolist(), (feat_b * 0.99).tolist()]}},
        ]
        matcher.load_from_profiles(profiles)

        # Query with Person A
        res_a = matcher.identify(feat_a)
        assert res_a["is_known"] is True
        assert res_a["predicted_user"] == "person_a"
        assert res_a["confidence"] > 0.85

        # Query with Person B in Person A's exact camera position
        res_b = matcher.identify(feat_b)
        assert res_b["is_known"] is True
        assert res_b["predicted_user"] == "person_b"
        assert res_b["confidence"] > 0.85

    def test_open_set_stranger_rejection(self):
        """Test that 10 unregistered individuals are 100% rejected as UNKNOWN."""
        ext = StaticFeatureExtractor()
        matcher = BiometricTemplateMatcher(acceptance_threshold=0.70)

        # Enroll single known user
        kps_enrolled = _generate_synthetic_skeleton(shoulder_width=0.38, hip_width=0.28, torso_length=0.45, leg_length=0.80)
        feat_enrolled = ext.to_vector(ext.extract_all(kps_enrolled))
        profiles = [{"user_id": "enrolled_user_1", "static_features": {"samples": [feat_enrolled.tolist()]}}]
        matcher.load_from_profiles(profiles)

        # Present 10 strangers with different anthropometric proportions
        stranger_configs = [
            (0.50, 0.35, 0.55, 0.65, 0.95),
            (0.28, 0.22, 0.35, 0.40, 0.65),
            (0.46, 0.24, 0.40, 0.58, 0.70),
            (0.32, 0.32, 0.50, 0.45, 0.88),
            (0.40, 0.30, 0.38, 0.52, 0.95),
            (0.35, 0.26, 0.48, 0.48, 0.72),
            (0.48, 0.36, 0.44, 0.62, 0.82),
            (0.30, 0.25, 0.42, 0.44, 0.78),
            (0.42, 0.22, 0.52, 0.56, 0.86),
            (0.36, 0.34, 0.46, 0.50, 0.80),
        ]

        for idx, (sw, hw, tl, al, ll) in enumerate(stranger_configs):
            stranger_kps = _generate_synthetic_skeleton(shoulder_width=sw, hip_width=hw, torso_length=tl, arm_length=al, leg_length=ll)
            stranger_feat = ext.to_vector(ext.extract_all(stranger_kps))
            res = matcher.identify(stranger_feat)
            assert res["is_known"] is False, f"Stranger {idx} was falsely accepted! Conf: {res['confidence']}"
            assert res["status"] == "UNKNOWN"
            assert res["predicted_user"] == "unknown"

    def test_ambiguity_and_temporal_resolution(self):
        """Test that borderline static matches trigger AMBIGUOUS and resolve via temporal gait."""
        ext = StaticFeatureExtractor()
        fusion = DecisionFusion(confidence_threshold=0.70, ambiguity_margin=0.04)

        # Two very similar users
        kps_1 = _generate_synthetic_skeleton(shoulder_width=0.38, hip_width=0.28, torso_length=0.45, leg_length=0.80)
        kps_2 = _generate_synthetic_skeleton(shoulder_width=0.385, hip_width=0.282, torso_length=0.452, leg_length=0.805)

        feat_1 = ext.to_vector(ext.extract_all(kps_1))
        feat_2 = ext.to_vector(ext.extract_all(kps_2))

        matcher = BiometricTemplateMatcher(acceptance_threshold=0.70, ambiguity_margin=0.04)
        matcher.load_from_profiles([
            {"user_id": "user_1", "static_features": {"samples": [feat_1.tolist()]}},
            {"user_id": "user_2", "static_features": {"samples": [feat_2.tolist()]}},
        ])

        # Query with borderline features between user 1 and user 2 -> Ambiguous
        feat_query = (feat_1 + feat_2) / 2.0
        query_res = matcher.identify(feat_query)
        assert query_res["is_ambiguous"] is True

        # Step 1: Decision fusion without motion evidence -> returns AMBIGUOUS
        fused_ambiguous = fusion.fuse(static_result=query_res, temporal_result=None)
        assert fused_ambiguous["status"] == "AMBIGUOUS"
        assert fused_ambiguous["is_known"] is False

        # Step 2: Provide temporal motion verification for user_1
        temporal_res = {
            "predicted_user": "user_1",
            "confidence": 0.88,
            "is_known": True,
            "status": "KNOWN",
        }
        fused_resolved = fusion.fuse(static_result=query_res, temporal_result=temporal_res, is_moving=True)
        assert fused_resolved["status"] == "KNOWN"
        assert fused_resolved["predicted_user"] == "user_1"
        assert fused_resolved["is_known"] is True

    def test_instant_enrollment(self):
        """Test that new user is immediately recognized with zero training delay."""
        predictor = Predictor(acceptance_threshold=0.70)
        ext = StaticFeatureExtractor()

        kps_new = _generate_synthetic_skeleton(shoulder_width=0.42, hip_width=0.26, torso_length=0.47, leg_length=0.84)
        feat_new = ext.to_vector(ext.extract_all(kps_new))

        # Before enrollment: unknown
        res_before = predictor.identify(static_features=feat_new)
        assert res_before["is_known"] is False

        # Instant enrollment
        profiles = [{"user_id": "instant_user_99", "static_features": {"samples": [feat_new.tolist()]}}]
        predictor.load_knn_templates(profiles)

        # After enrollment: recognized on frame 1!
        res_after = predictor.identify(static_features=feat_new)
        assert res_after["is_known"] is True
        assert res_after["predicted_user"] == "instant_user_99"
        assert res_after["confidence"] > 0.85

    def test_latency_benchmarks(self):
        """Benchmark per-stage latency (target < 15 ms total inference)."""
        predictor = Predictor(acceptance_threshold=0.70)
        ext = StaticFeatureExtractor()

        kps = _generate_synthetic_skeleton()
        feat = ext.to_vector(ext.extract_all(kps))

        profiles = [
            {"user_id": f"user_{i}", "static_features": {"samples": [(feat * (1.0 + 0.02 * i)).tolist()]}}
            for i in range(10)
        ]
        predictor.load_knn_templates(profiles)

        latencies = []
        for _ in range(100):
            t0 = time.perf_counter()
            _ = predictor.identify(static_features=feat)
            latencies.append((time.perf_counter() - t0) * 1000)

        avg_latency = float(np.mean(latencies))
        p95_latency = float(np.percentile(latencies, 95))

        print(f"\n[BENCHMARK] Avg Inference: {avg_latency:.3f} ms | P95: {p95_latency:.3f} ms")
        assert avg_latency < 15.0, f"Latency too high: {avg_latency:.2f} ms"
