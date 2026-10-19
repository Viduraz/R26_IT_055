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
    # Absolute metric dimensions in metres — real adult population spreads.
    "shoulder_width_m": 0.028,
    "trunk_scale_m": 0.035,
    "arm_length_m": 0.035,
    "leg_length_m": 0.050,
    "stature_est_m": 0.060,
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

    # ── Decision geometry, expressed in weighted population-sigma units ───────
    # A query beyond REJECT_DISTANCE is nobody we know. SOFT_DISTANCE is where
    # the absolute fit starts being penalised on its way to that boundary.
    REJECT_DISTANCE = 1.60
    SOFT_DISTANCE = 0.90
    # How much nearer the winner must be than the runner-up before the two are
    # considered separable at all. Below this the identity is a coin flip.
    AMBIGUITY_MIN_RATIO = 1.20
    # Shapes the ratio -> confidence curve (smaller = confidence rises faster).
    RATIO_CONFIDENCE_SCALE = 0.12

    def __init__(
        self,
        acceptance_threshold: float = 0.45,
        ambiguity_margin: float = 0.04,
        temperature: float = 0.85,
        regularization_lambda: float = 0.5,
    ):
        self.acceptance_threshold = acceptance_threshold
        # Retained for API compatibility. Ambiguity is now decided on the ratio
        # between the two nearest distances rather than on a difference between
        # two similarity scores, which made the test depend on the (arbitrary)
        # steepness of the similarity curve.
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
        metric_keys = set(StaticFeatureExtractor.METRIC_SCALE_FEATURE_KEYS)
        weights = np.ones(len(keys), dtype=np.float64)
        for idx, k in enumerate(keys):
            if k in metric_keys:
                # Absolute body size is what separates two people holding the
                # same pose in the same spot — weight it as strongly as the
                # proportion indices.
                weights[idx] = 3.0
            elif "ratio" in k or "index" in k:
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
        stale_users: List[str] = []

        for profile in profiles:
            uid = profile.get("user_id")
            if not uid:
                continue

            # Reject profiles enrolled under an older feature definition. Mixing
            # feature versions puts users into different coordinate systems, so
            # the nearest template is decided by the version mismatch rather than
            # by the person — the classic "identified as somebody else" failure.
            profile_version = profile.get("feature_version") or "unknown"
            if profile_version != self.FEATURE_VERSION:
                stale_users.append(f"{uid}({profile_version})")
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
        if stale_users:
            log.warning(
                "biometric_templates_stale_version_skipped",
                users=stale_users,
                expected=self.FEATURE_VERSION,
                action="These users must be re-enrolled before they can be identified.",
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

    def _match_distance(self, vec: np.ndarray, tmpl: Dict[str, Any]) -> float:
        """Distance to a template: centroid fit blended with nearest-sample fit.

        The nearest-sample term lets a template built from many poses match the
        pose the subject happens to be in, instead of only its average pose.
        """
        d_centroid = self.compute_distance(vec, tmpl)

        samples = tmpl.get("samples", [])
        if len(samples) <= 1:
            return d_centroid

        diffs = (samples - vec) / self.pop_std
        sample_dists = np.sqrt(
            np.sum(self.feature_weights * (diffs ** 2), axis=1) / np.sum(self.feature_weights)
        )
        sample_dists.sort()
        k_top = min(5, len(sample_dists))
        d_knn = float(np.mean(sample_dists[:k_top]))

        return 0.40 * d_centroid + 0.60 * d_knn

    def _absolute_fit(self, distance: float) -> float:
        """1.0 while the fit is comfortably plausible, fading to 0 at the reject radius."""
        span = self.REJECT_DISTANCE - self.SOFT_DISTANCE
        return float(np.clip((self.REJECT_DISTANCE - distance) / span, 0.0, 1.0))

    def _confidence(self, d_best: float, d_runner_up: Optional[float]) -> float:
        """Confidence that the nearest template is the right identity.

        Scored on how much *nearer* the winner is than its best competitor, not on
        an absolute similarity. Absolute similarity cannot be thresholded reliably:
        a genuine match sits around 0.65-0.80 sigma away purely from landmark
        noise, so any threshold high enough to exclude an impostor also excludes
        the real person — which is what drove the previous code to bypass its own
        threshold and take the top candidate regardless.

        The competing hypothesis is whichever is nearer: the runner-up template,
        or "not enrolled at all" (the reject radius). That makes a single-user
        deployment score naturally, and stops a far-away runner-up from inflating
        confidence beyond what the absolute fit supports.
        """
        d_best = max(d_best, 1e-6)
        competitor = self.REJECT_DISTANCE
        if d_runner_up is not None:
            competitor = min(competitor, d_runner_up)

        ratio = competitor / d_best
        gap = max(ratio - 1.0, 0.0)
        separation = gap / (gap + self.RATIO_CONFIDENCE_SCALE)

        return float(np.clip(self._absolute_fit(d_best) * separation, 0.0, 1.0))

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

        scored = sorted(
            (
                {"user_id": uid, "distance": self._match_distance(vec_raw, tmpl)}
                for uid, tmpl in self.templates.items()
            ),
            key=lambda s: s["distance"],
        )

        if not scored:
            return {
                "predicted_user": "unknown",
                "confidence": 0.0,
                "is_known": False,
                "status": "UNKNOWN",
                "method": "anthropometric_prototype",
                "top_k": [],
            }

        d_best = scored[0]["distance"]
        d_second = scored[1]["distance"] if len(scored) > 1 else None
        best_conf = self._confidence(d_best, d_second)

        # Per-candidate score, each judged against "not enrolled" so the numbers
        # stay comparable and monotone in distance for display purposes.
        top = [
            {
                "user_id": s["user_id"],
                "confidence": round(self._confidence(s["distance"], None), 4),
                "distance": round(s["distance"], 4),
            }
            for s in scored[:top_k]
        ]

        # 1. Open-set rejection: nothing enrolled is close enough to be this person.
        if d_best > self.REJECT_DISTANCE:
            return {
                "predicted_user": "unknown",
                "confidence": round(best_conf, 4),
                "is_known": False,
                "status": "UNKNOWN",
                "is_ambiguous": False,
                "reason": "No enrolled body proportions within the acceptance radius",
                "method": "anthropometric_prototype",
                "top_k": top,
            }

        # 2. Two enrolled people fit this body almost equally well. This is the
        #    same-position / similar-build case: the winner is decided by noise,
        #    so report the tie instead of picking a name from it.
        is_ambiguous = (
            d_second is not None and (d_second / max(d_best, 1e-6)) < self.AMBIGUITY_MIN_RATIO
        )
        if is_ambiguous:
            return {
                "predicted_user": scored[0]["user_id"],
                "confidence": round(best_conf, 4),
                "is_known": False,
                "status": "AMBIGUOUS",
                "is_ambiguous": True,
                "reason": (
                    f"{scored[0]['user_id']} and {scored[1]['user_id']} are within "
                    f"{(d_second / max(d_best, 1e-6) - 1.0) * 100:.0f}% of each other"
                ),
                "method": "anthropometric_prototype",
                "top_k": top,
            }

        # 3. Clear winner, subject to the acceptance threshold.
        if best_conf < self.acceptance_threshold:
            return {
                "predicted_user": "unknown",
                "confidence": round(best_conf, 4),
                "is_known": False,
                "status": "UNKNOWN",
                "is_ambiguous": False,
                "reason": "Match too weak to accept",
                "method": "anthropometric_prototype",
                "top_k": top,
            }

        return {
            "predicted_user": scored[0]["user_id"],
            "confidence": round(best_conf, 4),
            "is_known": True,
            "status": "KNOWN",
            "is_ambiguous": False,
            "method": "anthropometric_prototype",
            "top_k": top,
        }
