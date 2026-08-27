"""
services/identification/models/template_knn.py
K-Nearest-Neighbor template matcher for skeleton-based person identification.

Uses cosine similarity between a live feature vector and the stored mean
enrollment vectors of all enrolled users.  For small enrollment pools (2-15
people) this is *significantly* more reliable than the probabilistic SVM
classifier, because it compares directly against the actual enrolled data
rather than through a learned decision boundary that needs abundant diverse
training samples to generalise.

This is designed to work **alongside** the SVM, not replace it — the two
signals are fused in stream.py's multi-model identification logic.
"""
import numpy as np
import structlog
from typing import Dict, List, Any, Optional

log = structlog.get_logger()


class TemplateIdentifier:
    """Direct cosine-similarity identification against enrolled feature templates.

    Each enrolled user's feature profile (from MongoDB) contains a mean_vector
    (the average of all their enrollment frames' 42-dim static feature vectors)
    and optionally the individual samples.  At identification time we compute
    the cosine similarity between the live observation and every enrolled
    user's mean vector, and return the ranked list.

    Why cosine similarity?
    ─────────────────────
    Skeleton body-proportion features are scale-invariant ratios and angles,
    so the *direction* of the feature vector is more stable across frames than
    its magnitude (which is affected by noise, partial visibility, etc.).
    Cosine similarity captures exactly this directional agreement, making it
    robust to the frame-to-frame magnitude jitter that hurts Euclidean-based
    methods and the SVM.
    """

    def __init__(self):
        # user_id → { "mean_norm": normalized mean vector, "sample_count": int }
        self.templates: Dict[str, Dict[str, Any]] = {}
        self._loaded = False

    @property
    def is_ready(self) -> bool:
        return self._loaded and len(self.templates) > 0

    def load_from_profiles(self, profiles: List[Dict]) -> int:
        """Build the template index from feature profile dicts (as returned
        by FeatureProfileCRUD.get_all_profiles()).

        Returns the number of users loaded.
        """
        self.templates.clear()

        for profile in profiles:
            uid = profile.get("user_id")
            static = profile.get("static_features", {})
            mean_vec = static.get("mean_vector")
            if uid is None or mean_vec is None:
                continue

            arr = np.array(mean_vec, dtype=np.float64)
            norm = np.linalg.norm(arr)
            if norm < 1e-8:
                continue  # degenerate — skip

            # Also compute per-sample statistics for adaptive thresholding:
            # the intra-user variance tells us how "tight" this user's template
            # is, so we can set a tighter or looser acceptance threshold.
            samples = static.get("samples", [])
            sample_norms = []
            for s in samples:
                sv = np.array(s, dtype=np.float64)
                sn = np.linalg.norm(sv)
                if sn > 1e-8:
                    sample_norms.append(sv / sn)

            intra_sims = []
            mean_norm = arr / norm
            for sn in sample_norms:
                intra_sims.append(float(np.dot(mean_norm, sn)))

            # The minimum intra-user similarity gives us a conservative
            # acceptance threshold: if a live observation is *less* similar
            # to the mean than the worst enrollment sample was, it's probably
            # not the same person.
            min_intra = float(min(intra_sims)) if intra_sims else 0.80
            avg_intra = float(np.mean(intra_sims)) if intra_sims else 0.90

            self.templates[uid] = {
                "mean_norm": mean_norm,
                "sample_count": len(samples),
                "min_intra_sim": min_intra,
                "avg_intra_sim": avg_intra,
                # Adaptive threshold: slightly below the worst enrollment
                # sample, clamped to a reasonable floor.
                "accept_threshold": max(min_intra - 0.02, 0.85),
            }

        self._loaded = True
        log.info(
            "template_knn_loaded",
            num_users=len(self.templates),
            users=list(self.templates.keys()),
        )
        return len(self.templates)

    def identify(
        self,
        feature_vector: np.ndarray,
        top_k: int = 5,
    ) -> Dict[str, Any]:
        """Identify a person by cosine similarity against all templates.

        Args:
            feature_vector: (n_features,) static feature vector from the live frame
            top_k: number of top candidates to return

        Returns:
            Dict with:
              predicted_user: str (user_id or "unknown")
              confidence: float (cosine similarity, 0..1)
              is_known: bool
              method: "knn"
              top_k: list of {user_id, confidence}
        """
        if not self.is_ready:
            return {
                "predicted_user": "unknown",
                "confidence": 0.0,
                "is_known": False,
                "method": "knn",
                "top_k": [],
            }

        vec = feature_vector.astype(np.float64)
        norm = np.linalg.norm(vec)
        if norm < 1e-8:
            return {
                "predicted_user": "unknown",
                "confidence": 0.0,
                "is_known": False,
                "method": "knn",
                "top_k": [],
            }

        vec_norm = vec / norm

        scores = []
        for uid, data in self.templates.items():
            sim = float(np.dot(vec_norm, data["mean_norm"]))
            # Clamp to [0, 1] — negative cosine similarity means completely
            # dissimilar, treat as 0.
            sim = max(sim, 0.0)
            scores.append({
                "user_id": uid,
                "confidence": sim,
                "accept_threshold": data["accept_threshold"],
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
        # A person is "known" if their similarity exceeds the adaptive
        # threshold for that template AND there's a clear margin over the
        # second-best match (disambiguation).
        is_known = best["confidence"] >= best["accept_threshold"]

        # Disambiguation: if the top two are very close, we can't tell who
        # this person is — mark as unknown to avoid misidentification.
        if is_known and len(top) >= 2:
            margin = best["confidence"] - top[1]["confidence"]
            if margin < 0.03:
                is_known = False

        # Clean up: remove internal fields from top_k output
        clean_top = [{"user_id": c["user_id"], "confidence": c["confidence"]} for c in top]

        return {
            "predicted_user": best["user_id"] if is_known else "unknown",
            "confidence": best["confidence"],
            "is_known": is_known,
            "method": "knn",
            "top_k": clean_top,
        }
