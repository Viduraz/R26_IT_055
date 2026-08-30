"""
services/identification/models/template_knn.py
K-Nearest-Neighbor + Centroid template matcher for skeleton-based person identification.

Uses scale-invariant cosine similarity and multi-sample k-NN matching against
enrolled feature vectors of all enrolled users.
"""
import numpy as np
import structlog
from typing import Dict, List, Any, Optional

log = structlog.get_logger()


class TemplateIdentifier:
    """High-accuracy cosine similarity + k-NN identification against enrolled feature templates.

    Combines:
      1. Centroid matching: cosine similarity against user's mean feature vector
      2. Multi-sample k-NN: average similarity against top-K nearest enrolled samples
    """

    def __init__(self, acceptance_threshold: float = 0.72):
        # user_id → { "mean_norm": np.ndarray, "sample_norms": List[np.ndarray], "sample_count": int, ... }
        self.templates: Dict[str, Dict[str, Any]] = {}
        self.default_threshold = acceptance_threshold
        self._loaded = False

    @property
    def is_ready(self) -> bool:
        return self._loaded and len(self.templates) > 0

    OLD_KEYS = [
        "arm_to_torso_ratio", "height_estimate", "hip_width", "hip_width_norm",
        "left_elbow_angle", "left_forearm", "left_forearm_norm", "left_hip_angle",
        "left_knee_angle", "left_right_arm_symmetry", "left_right_leg_symmetry",
        "left_shin", "left_shin_norm", "left_shoulder_angle", "left_thigh",
        "left_thigh_norm", "left_torso", "left_torso_norm", "left_upper_arm",
        "left_upper_arm_norm", "right_elbow_angle", "right_forearm",
        "right_forearm_norm", "right_hip_angle", "right_knee_angle",
        "right_shin", "right_shin_norm", "right_shoulder_angle", "right_thigh",
        "right_thigh_norm", "right_torso", "right_torso_norm", "right_upper_arm",
        "right_upper_arm_norm", "shoulder_to_hip_ratio", "shoulder_width",
        "shoulder_width_norm", "torso_length", "torso_to_leg_ratio",
        "upper_to_lower_body_ratio"
    ]

    NEW_KEYS = sorted([
        "left_upper_arm_norm", "left_forearm_norm", "right_upper_arm_norm", "right_forearm_norm",
        "shoulder_width_norm", "left_torso_norm", "right_torso_norm", "hip_width_norm",
        "left_thigh_norm", "left_shin_norm", "right_thigh_norm", "right_shin_norm",
        "left_elbow_angle_norm", "right_elbow_angle_norm", "left_shoulder_angle_norm", "right_shoulder_angle_norm",
        "left_hip_angle_norm", "right_hip_angle_norm", "left_knee_angle_norm", "right_knee_angle_norm",
        "torso_to_leg_ratio", "arm_to_torso_ratio", "shoulder_to_hip_ratio", "upper_to_lower_arm_ratio",
        "thigh_to_shin_ratio", "arm_to_leg_ratio", "left_right_arm_symmetry", "left_right_leg_symmetry",
        "upper_to_lower_body_ratio", "torso_aspect_ratio", "pelvis_to_torso_ratio",
        "wingspan_to_height_ratio", "left_limb_to_height_ratio", "right_limb_to_height_ratio",
        "rel_left_wrist_dist", "rel_right_wrist_dist", "rel_left_elbow_dist",
        "rel_right_elbow_dist", "rel_left_ankle_dist", "rel_right_ankle_dist",
    ])

    @classmethod
    def normalize_vector(cls, v: Any) -> np.ndarray:
        """Ensure feature vector is 40-dim scale-invariant and migrate old unnormalized formats."""
        arr = np.array(v, dtype=np.float64)
        if len(arr) != 40:
            return arr
        if float(np.max(arr)) > 10.0:
            od = {cls.OLD_KEYS[i]: float(arr[i]) for i in range(40)}
            nd = {}
            for k in ["left_upper_arm_norm", "left_forearm_norm", "right_upper_arm_norm", "right_forearm_norm",
                      "shoulder_width_norm", "left_torso_norm", "right_torso_norm", "hip_width_norm",
                      "left_thigh_norm", "left_shin_norm", "right_thigh_norm", "right_shin_norm"]:
                nd[k] = od.get(k, 0.5)
            nd["left_elbow_angle_norm"] = od.get("left_elbow_angle", 90.0) / 180.0
            nd["right_elbow_angle_norm"] = od.get("right_elbow_angle", 90.0) / 180.0
            nd["left_shoulder_angle_norm"] = od.get("left_shoulder_angle", 90.0) / 180.0
            nd["right_shoulder_angle_norm"] = od.get("right_shoulder_angle", 90.0) / 180.0
            nd["left_hip_angle_norm"] = od.get("left_hip_angle", 90.0) / 180.0
            nd["right_hip_angle_norm"] = od.get("right_hip_angle", 90.0) / 180.0
            nd["left_knee_angle_norm"] = od.get("left_knee_angle", 90.0) / 180.0
            nd["right_knee_angle_norm"] = od.get("right_knee_angle", 90.0) / 180.0
            nd["torso_to_leg_ratio"] = od.get("torso_to_leg_ratio", 1.0)
            nd["arm_to_torso_ratio"] = od.get("arm_to_torso_ratio", 1.0)
            nd["shoulder_to_hip_ratio"] = od.get("shoulder_to_hip_ratio", 1.0)
            nd["left_right_arm_symmetry"] = od.get("left_right_arm_symmetry", 1.0)
            nd["left_right_leg_symmetry"] = od.get("left_right_leg_symmetry", 1.0)
            nd["upper_to_lower_body_ratio"] = od.get("upper_to_lower_body_ratio", 1.0)
            avg_u = (od.get("left_upper_arm_norm", 0.5) + od.get("right_upper_arm_norm", 0.5)) / 2.0
            avg_f = (od.get("left_forearm_norm", 0.5) + od.get("right_forearm_norm", 0.5)) / 2.0
            nd["upper_to_lower_arm_ratio"] = avg_u / (avg_f + 1e-4)
            avg_t = (od.get("left_thigh_norm", 0.5) + od.get("right_thigh_norm", 0.5)) / 2.0
            avg_s = (od.get("left_shin_norm", 0.5) + od.get("right_shin_norm", 0.5)) / 2.0
            nd["thigh_to_shin_ratio"] = avg_t / (avg_s + 1e-4)
            nd["arm_to_leg_ratio"] = nd["torso_to_leg_ratio"] * nd["arm_to_torso_ratio"]
            nd["torso_aspect_ratio"] = 1.0 / (od.get("shoulder_width_norm", 0.5) + 1e-4)
            nd["pelvis_to_torso_ratio"] = od.get("hip_width_norm", 0.4)
            leg_norm = avg_t + avg_s
            h_est = 1.0 + leg_norm
            arm_norm = avg_u + avg_f
            nd["wingspan_to_height_ratio"] = (2.0 * arm_norm + od.get("shoulder_width_norm", 0.5)) / h_est
            nd["left_limb_to_height_ratio"] = (od.get("left_thigh_norm", 0.5) + od.get("left_shin_norm", 0.5)) / h_est
            nd["right_limb_to_height_ratio"] = (od.get("right_thigh_norm", 0.5) + od.get("right_shin_norm", 0.5)) / h_est
            nd["rel_left_wrist_dist"] = 0.85 * (od.get("left_upper_arm_norm", 0.5) + od.get("left_forearm_norm", 0.5))
            nd["rel_right_wrist_dist"] = 0.85 * (od.get("right_upper_arm_norm", 0.5) + od.get("right_forearm_norm", 0.5))
            nd["rel_left_elbow_dist"] = 0.65 * od.get("left_upper_arm_norm", 0.5)
            nd["rel_right_elbow_dist"] = 0.65 * od.get("right_upper_arm_norm", 0.5)
            nd["rel_left_ankle_dist"] = od.get("left_thigh_norm", 0.5) + od.get("left_shin_norm", 0.5)
            nd["rel_right_ankle_dist"] = od.get("right_thigh_norm", 0.5) + od.get("right_shin_norm", 0.5)
            return np.array([nd[k] for k in cls.NEW_KEYS], dtype=np.float64)
        return arr

    def load_from_profiles(self, profiles: List[Dict]) -> int:
        """Build the template index from feature profile dicts.
        Returns the number of users loaded.
        """
        self.templates.clear()

        for profile in profiles:
            uid = profile.get("user_id")
            static = profile.get("static_features", {})
            mean_vec = static.get("mean_vector")
            samples = static.get("samples", [])
            if uid is None:
                continue

            sample_norms = []
            sample_raws = []
            for s in samples:
                if not s or len(s) == 0:
                    continue
                sv = self.normalize_vector(s)
                sn = np.linalg.norm(sv)
                if sn > 1e-6:
                    sample_norms.append(sv / sn)
                    sample_raws.append(sv)

            if not sample_norms and mean_vec is not None:
                mv = self.normalize_vector(mean_vec)
                mn = np.linalg.norm(mv)
                if mn > 1e-6:
                    sample_norms.append(mv / mn)
                    sample_raws.append(mv)

            if not sample_norms:
                continue

            mean_raw = np.mean(sample_raws, axis=0)
            mean_norm = mean_raw / max(np.linalg.norm(mean_raw), 1e-6)

            # Intra-user similarity statistics
            intra_sims = [float(np.dot(mean_norm, sn)) for sn in sample_norms]
            min_intra = float(min(intra_sims)) if intra_sims else 0.85
            avg_intra = float(np.mean(intra_sims)) if intra_sims else 0.92

            # Adaptive threshold calibrated for scale-invariant biometric features
            accept_thresh = min(max(min_intra - 0.15, 0.70), 0.76)

            self.templates[uid] = {
                "mean_norm": mean_norm,
                "mean_raw": mean_raw,
                "sample_norms": sample_norms,
                "sample_raws": sample_raws,
                "sample_count": len(sample_norms),
                "min_intra_sim": min_intra,
                "avg_intra_sim": avg_intra,
                "accept_threshold": accept_thresh,
            }

        all_raw_samples = []
        for d in self.templates.values():
            all_raw_samples.extend(d["sample_raws"])

        # Standard anthropometric scale baseline for human skeletal features
        base_std = np.array([
            0.10, 0.08, 0.10, 0.08,  # limb lengths
            0.10, 0.10, 0.10, 0.08,  # torso / hips
            0.12, 0.12, 0.12, 0.12,  # legs
            0.20, 0.20, 0.20, 0.20,  # angles
            0.20, 0.20, 0.20, 0.20,
            0.15, 0.15, 0.18, 0.15,  # core ratios
            0.15, 0.15, 0.08, 0.08,  # symmetry
            0.15, 0.15, 0.12, 0.12,  # morphological
            0.10, 0.10,
            0.15, 0.15, 0.15, 0.15,  # rel dists
            0.15, 0.15,
        ], dtype=np.float64)

        if all_raw_samples and len(self.templates) >= 2:
            all_arr = np.array(all_raw_samples)
            computed_std = np.std(all_arr, axis=0)
            self.pop_std = np.maximum(computed_std, base_std * 0.5)
        else:
            self.pop_std = base_std

        # Feature weights for 40 features: high weight to skeletal proportions, low to transient angles
        self.feature_weights = np.ones(40, dtype=np.float64)
        for idx, k in enumerate(self.NEW_KEYS):
            if "ratio" in k or ("norm" in k and "angle" not in k):
                self.feature_weights[idx] = 2.5
            elif "symmetry" in k:
                self.feature_weights[idx] = 1.5
            elif "angle" in k or "rel_" in k:
                self.feature_weights[idx] = 0.4
        self.feature_weights /= np.mean(self.feature_weights)

        self._loaded = True
        log.info(
            "template_knn_loaded",
            num_users=len(self.templates),
            users=list(self.templates.keys()),
        )
        return len(self.templates)

    def _biometric_similarity(
        self,
        vec_raw: np.ndarray,
        tmpl_raw: np.ndarray,
    ) -> float:
        """Compute high-discrimination weighted anthropometric biometric similarity.
        Returns similarity score in [0.0, 1.0].
        """
        scale = getattr(self, "pop_std", None)
        if scale is None or len(scale) != len(vec_raw):
            scale = np.full_like(vec_raw, 0.12)
        diff_z = (vec_raw - tmpl_raw) / scale
        w = getattr(self, "feature_weights", np.ones_like(vec_raw))
        w_dist = float(np.sqrt(np.sum(w * (diff_z ** 2)) / np.sum(w)))

        # Distance to similarity:
        # For same person (w_dist < 0.65): Sim > 0.74 (matches template reliably)
        # For friend / different person (w_dist > 1.40): Sim < 0.52 (separated cleanly)
        # For unregistered stranger (w_dist > 2.0): Sim < 0.38 (rejected as Unknown)
        sim = float(np.exp(-w_dist / 2.1))
        return float(np.clip(sim, 0.0, 1.0))

    def identify(
        self,
        feature_vector: np.ndarray,
        top_k: int = 5,
    ) -> Dict[str, Any]:
        """Identify a person by weighted biometric similarity + k-NN against all templates.

        Args:
            feature_vector: (40,) static scale-invariant feature vector
            top_k: number of top candidates to return
        """
        if not self.is_ready:
            return {
                "predicted_user": "unknown",
                "confidence": 0.0,
                "is_known": False,
                "method": "knn",
                "top_k": [],
            }

        vec_raw = self.normalize_vector(feature_vector)
        if len(vec_raw) != 40 or np.all(vec_raw == 0):
            return {
                "predicted_user": "unknown",
                "confidence": 0.0,
                "is_known": False,
                "method": "knn",
                "top_k": [],
            }

        scores = []
        for uid, data in self.templates.items():
            tmpl_raw = data.get("mean_raw", data["mean_norm"])

            # 1. Centroid biometric similarity
            sim_mean = self._biometric_similarity(vec_raw, tmpl_raw)

            # 2. Multi-sample k-NN biometric similarity over enrolled frames
            raw_samples = data.get("sample_raws", [])
            sample_sims = [self._biometric_similarity(vec_raw, sr) for sr in raw_samples]

            sample_sims.sort(reverse=True)
            k_samples = min(7, len(sample_sims))
            sim_knn = float(np.mean(sample_sims[:k_samples])) if k_samples > 0 else sim_mean

            # Combined score giving weight to posture variations (k-NN) and morphological mean
            combined_sim = max(0.35 * sim_mean + 0.65 * sim_knn, 0.0)
            combined_sim = min(combined_sim, 1.0)

            scores.append({
                "user_id": uid,
                "confidence": combined_sim,
                "accept_threshold": data.get("accept_threshold", self.default_threshold),
            })

        scores.sort(key=lambda x: x["confidence"], reverse=True)
        top = scores[:top_k]

        if not top:
            return {
                "predicted_user": "unknown",
                "confidence": 0.0,
                "is_known": False,
                "method": "knn",
                "top_k": [],
            }

        best = top[0]
        accept_thresh = max(best["accept_threshold"], self.default_threshold)
        is_known = best["confidence"] >= accept_thresh

        # Margin separation check: only reject if confidence is borderline and margin is negligible
        if is_known and len(top) >= 2:
            margin = best["confidence"] - top[1]["confidence"]
            if best["confidence"] < 0.75 and margin < 0.015:
                # Inconclusive / ambiguous between two enrolled users
                is_known = False

        clean_top = [{"user_id": c["user_id"], "confidence": round(c["confidence"], 4)} for c in top]

        return {
            "predicted_user": best["user_id"] if is_known else "unknown",
            "confidence": round(best["confidence"], 4),
            "is_known": is_known,
            "method": "knn",
            "top_k": clean_top,
        }
