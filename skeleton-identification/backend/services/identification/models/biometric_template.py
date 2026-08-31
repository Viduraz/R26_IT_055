"""
services/identification/models/biometric_template.py
Weighted Anthropometric Prototype Matcher with Regularized Mahalanobis Distance
and Open-Set Stranger Rejection.

Provides instant enrollment, zero-retraining inference, and strict open-set identification
with ambiguity detection for same-pose discrimination.
"""
import numpy as np
import structlog
from typing import Dict, List, Any, Optional, Tuple

from services.feature_extraction.static_features import StaticFeatureExtractor

log = structlog.get_logger()


FEATURE_POPULATION_STD_MAP = {
    "shoulder_width_norm": 0.035,
    "hip_width_norm": 0.030,
    "torso_length_norm": 0.035,
    "left_upper_arm_norm": 0.030,
    "right_upper_arm_norm": 0.030,
    "left_forearm_norm": 0.030,
    "right_forearm_norm": 0.030,
    "left_thigh_norm": 0.038,
    "right_thigh_norm": 0.038,
    "left_shin_norm": 0.038,
    "right_shin_norm": 0.038,
    "total_leg_norm": 0.035,
    "total_arm_norm": 0.030,
    "shoulder_to_hip_ratio": 0.055,
    "torso_to_leg_ratio": 0.045,
    "brachial_index": 0.045,
    "crural_index": 0.045,
    "arm_to_leg_ratio": 0.045,
    "arm_to_torso_ratio": 0.045,
    "wingspan_to_height_ratio": 0.040,
    "upper_to_lower_body_ratio": 0.045,
    "torso_aspect_ratio": 0.050,
    "pelvis_to_torso_ratio": 0.045,
    "left_right_arm_symmetry": 0.025,
}

# Natural standard deviation bounds across human populations for 24 anthropometric features
NATURAL_POPULATION_STD = np.array(
    [FEATURE_POPULATION_STD_MAP.get(k, 0.035) for k in StaticFeatureExtractor.ANTHROPOMETRIC_FEATURE_KEYS],
    dtype=np.float64,
)


class BiometricTemplateMatcher:
    """Open-set anthropometric biometric template matcher using regularized Mahalanobis distance."""

    FEATURE_VERSION = StaticFeatureExtractor.FEATURE_VERSION
    NATURAL_POPULATION_STD = NATURAL_POPULATION_STD

    def __init__(
        self,
        acceptance_threshold: float = 0.45,
        ambiguity_margin: float = 0.04,
        temperature: float = 0.85,
        regularization_lambda: float = 0.5,
    ):
        self.acceptance_threshold = acceptance_threshold
        self.ambiguity_margin = ambiguity_margin
        self.temperature = temperature
        self.regularization_lambda = regularization_lambda

        # user_id -> template dict
        self.templates: Dict[str, Dict[str, Any]] = {}
        self.pop_mean: np.ndarray = np.zeros(len(self.NATURAL_POPULATION_STD))
        self.pop_std: np.ndarray = np.array(self.NATURAL_POPULATION_STD)
        self.feature_weights: np.ndarray = self._compute_feature_weights()
        self._loaded: bool = False

    def _compute_feature_weights(self) -> np.ndarray:
        """Assign high weights to invariant biological indices and standard weights to limb lengths."""
        keys = StaticFeatureExtractor.ANTHROPOMETRIC_FEATURE_KEYS
        weights = np.ones(len(keys), dtype=np.float64)
        for idx, k in enumerate(keys):
            if "ratio" in k or "index" in k:
                # Key biological proportions get highest discriminative weight
                weights[idx] = 3.0
            elif "symmetry" in k:
                weights[idx] = 1.5
            else:
                # Normalized segment lengths
                weights[idx] = 2.0
        return weights / np.mean(weights)

    @property
    def is_ready(self) -> bool:
        return self._loaded and len(self.templates) > 0

    def load_from_profiles(self, profiles: List[Dict]) -> int:
        """Load enrolled templates from database profile dictionaries.

        Computes mean centroids, intra-user variance, and population scale.
        """
        self.templates.clear()
        all_raw_samples = []

        for profile in profiles:
            uid = profile.get("user_id")
            if not uid:
                continue

            static_data = profile.get("static_features", {})
            samples = static_data.get("samples", [])
            mean_vec = static_data.get("mean_vector")

            valid_samples = []
            for s in samples:
                if not s or len(s) == 0:
                    continue
                v = StaticFeatureExtractor.normalize_vector(s)
                if len(v) == len(self.NATURAL_POPULATION_STD):
                    valid_samples.append(v)
                    all_raw_samples.append(v)

            if not valid_samples and mean_vec is not None:
                v = StaticFeatureExtractor.normalize_vector(mean_vec)
                if len(v) == len(self.NATURAL_POPULATION_STD):
                    valid_samples.append(v)
                    all_raw_samples.append(v)

            if not valid_samples:
                continue

            samples_arr = np.array(valid_samples, dtype=np.float64)
            centroid = np.mean(samples_arr, axis=0)
            variance = np.var(samples_arr, axis=0) if len(valid_samples) > 1 else np.zeros_like(centroid)

            self.templates[uid] = {
                "user_id": uid,
                "centroid": centroid,
                "variance": variance,
                "samples": samples_arr,
                "sample_count": len(valid_samples),
                "feature_version": profile.get("feature_version", self.FEATURE_VERSION),
            }

        # Compute or calibrate population standard deviation
        if all_raw_samples and len(self.templates) >= 2:
            all_arr = np.array(all_raw_samples, dtype=np.float64)
            computed_std = np.std(all_arr, axis=0)
            self.pop_mean = np.mean(all_arr, axis=0)
            self.pop_std = np.maximum(computed_std, self.NATURAL_POPULATION_STD * 0.5)
        else:
            self.pop_mean = np.zeros(len(self.NATURAL_POPULATION_STD))
            self.pop_std = np.array(self.NATURAL_POPULATION_STD)

        self._loaded = True
        log.info(
            "biometric_templates_loaded",
            num_users=len(self.templates),
            users=list(self.templates.keys()),
            version=self.FEATURE_VERSION,
        )
        return len(self.templates)

    def compute_distance(self, feature_vector: np.ndarray, template: Dict[str, Any]) -> float:
        """Compute regularized Mahalanobis distance between query vector and enrolled template."""
        diff = feature_vector - template["centroid"]
        effective_var = (self.pop_std ** 2) + self.regularization_lambda * template["variance"]
        effective_std = np.sqrt(np.maximum(effective_var, 1e-4))
        diff_z = diff / effective_std
        w_dist = float(np.sqrt(np.sum(self.feature_weights * (diff_z ** 2)) / np.sum(self.feature_weights)))
        return w_dist

    def identify(
        self,
        feature_vector: np.ndarray,
        top_k: int = 5,
    ) -> Dict[str, Any]:
        """Perform open-set anthropometric identification.

        Returns candidate identities, calibrated similarity, and ambiguity status.
        """
        if not self.is_ready:
            return {
                "predicted_user": "unknown",
                "confidence": 0.0,
                "is_known": False,
                "status": "UNKNOWN",
                "reason": "Templates not loaded",
                "method": "anthropometric_prototype",
                "top_k": [],
            }

        vec_raw = StaticFeatureExtractor.normalize_vector(feature_vector)
        if len(vec_raw) != len(self.NATURAL_POPULATION_STD) or np.all(vec_raw == 0):
            return {
                "predicted_user": "unknown",
                "confidence": 0.0,
                "is_known": False,
                "status": "UNKNOWN",
                "reason": "Invalid feature dimensions",
                "method": "anthropometric_prototype",
                "top_k": [],
            }

        scores = []
        for uid, tmpl in self.templates.items():
            # 1. Centroid Mahalanobis Distance
            dist_centroid = self.compute_distance(vec_raw, tmpl)
            sim_centroid = float(np.exp(-dist_centroid / self.temperature))

            # 2. Nearest Sample Distance (k-NN support across multi-pose clusters)
            samples = tmpl.get("samples", [])
            if len(samples) > 1:
                diffs_knn = (samples - vec_raw) / self.pop_std
                sample_dists = np.sqrt(np.sum(self.feature_weights * (diffs_knn ** 2), axis=1) / np.sum(self.feature_weights))
                sample_dists.sort()
                k_top = min(5, len(sample_dists))
                knn_dist = float(np.mean(sample_dists[:k_top]))
                sim_knn = float(np.exp(-knn_dist / self.temperature))
            else:
                sim_knn = sim_centroid

            # Fused similarity: 40% centroid + 60% top multi-pose k-NN
            fused_sim = float(np.clip(0.40 * sim_centroid + 0.60 * sim_knn, 0.0, 1.0))
            scores.append({
                "user_id": uid,
                "confidence": round(fused_sim, 4),
                "distance": round(dist_centroid, 4),
            })

        scores.sort(key=lambda x: x["confidence"], reverse=True)
        top = scores[:top_k]

        if not top:
            return {
                "predicted_user": "unknown",
                "confidence": 0.0,
                "is_known": False,
                "status": "UNKNOWN",
                "method": "anthropometric_prototype",
                "top_k": [],
            }

        best = top[0]
        best_conf = best["confidence"]
        is_above_threshold = best_conf >= self.acceptance_threshold

        # Ambiguity Check (Same-pose or borderline candidates)
        is_ambiguous = False
        if is_above_threshold and len(top) >= 2:
            margin = best_conf - top[1]["confidence"]
            if margin < self.ambiguity_margin:
                is_ambiguous = True

        if not is_above_threshold:
            status = "UNKNOWN"
            pred_user = "unknown"
            is_known = False
        else:
            status = "KNOWN" if not is_ambiguous else "AMBIGUOUS"
            pred_user = best["user_id"]
            is_known = True

        return {
            "predicted_user": pred_user,
            "confidence": best_conf,
            "is_known": is_known,
            "status": status,
            "is_ambiguous": is_ambiguous,
            "method": "anthropometric_prototype",
            "top_k": top,
        }
