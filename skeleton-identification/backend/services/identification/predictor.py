"""
services/identification/predictor.py
Real-time prediction pipeline using the ensemble model (SVM + LSTM)
combined with a KNN template matcher for multi-model identification.
"""
import numpy as np
import time
import structlog
from pathlib import Path
from typing import Dict, Any, Optional, List

from .models.ensemble import EnsembleIdentifier
from .models.template_knn import TemplateIdentifier

log = structlog.get_logger()


class Predictor:
    """Real-time identification using SVM ensemble + KNN template matching.

    Multi-model strategy:
      1. SVM ensemble (static + optional gait) produces a prediction
      2. KNN template matcher (cosine similarity vs enrolled vectors) produces a prediction
      3. Fuse: agreement boosts confidence, disagreement uses the stronger signal
    """

    def __init__(
        self,
        model_dir: str = "./models",
        svm_weight: float = 0.5,
        lstm_weight: float = 0.5,
        confidence_threshold: float = 0.65,
    ):
        self.model_dir = model_dir
        self.ensemble = EnsembleIdentifier(
            svm_weight=svm_weight,
            lstm_weight=lstm_weight,
            confidence_threshold=confidence_threshold,
        )
        self.knn = TemplateIdentifier()
        self._loaded = False

    def load_models(self) -> bool:
        """Load trained models from disk."""
        path = Path(self.model_dir)
        if not path.exists():
            log.warning("model_dir_not_found", path=str(path))
            return False

        try:
            self.ensemble.load(self.model_dir)
            self._loaded = self.ensemble.is_trained
            log.info(
                "models_loaded",
                svm=self.ensemble.svm_ready,
                lstm=self.ensemble.lstm_ready,
            )
            return self._loaded
        except Exception as e:
            log.error("model_load_failed", error=str(e))
            return False

    def load_knn_templates(self, profiles: List[Dict]) -> int:
        """Load KNN templates from feature profile dicts.
        Call this after DB is connected and periodically to refresh.
        Returns the number of users loaded."""
        return self.knn.load_from_profiles(profiles)

    @property
    def is_ready(self) -> bool:
        # Ready if either SVM or KNN is available
        return (self._loaded and self.ensemble.is_trained) or self.knn.is_ready

    @property
    def knn_ready(self) -> bool:
        return self.knn.is_ready

    def identify(
        self,
        static_features: Optional[np.ndarray] = None,
        gait_sequence: Optional[np.ndarray] = None,
        top_k: int = 5,
    ) -> Dict[str, Any]:
        """Run multi-model identification (SVM + KNN).

        Args:
            static_features: (42,) static feature vector
            gait_sequence: (30, 8) angle time series for LSTM

        Returns:
            Identification result dict with fused SVM + KNN output
        """
        t_start = time.perf_counter()

        if not self.is_ready:
            return {
                "predicted_user": "unknown",
                "confidence": 0.0,
                "is_known": False,
                "method": "none",
                "error": "Models not loaded",
                "latency_ms": 0.0,
            }

        # ── SVM ensemble prediction ──────────────────────────────────────
        svm_result = None
        if self._loaded and self.ensemble.is_trained and static_features is not None:
            svm_result = self.ensemble.predict(
                static_features=static_features,
                gait_sequence=gait_sequence,
                top_k=top_k,
            )

        # ── KNN template prediction ──────────────────────────────────────
        knn_result = None
        if self.knn.is_ready and static_features is not None:
            knn_result = self.knn.identify(
                feature_vector=static_features,
                top_k=top_k,
            )

        # ── Fuse SVM + KNN ───────────────────────────────────────────────
        result = self._fuse_svm_knn(svm_result, knn_result)

        latency = (time.perf_counter() - t_start) * 1000
        result["latency_ms"] = round(latency, 2)

        return result

    def _fuse_svm_knn(
        self,
        svm_result: Optional[Dict],
        knn_result: Optional[Dict],
    ) -> Dict[str, Any]:
        """Fuse SVM ensemble and KNN template predictions for open-set biometric identification.

        Core Principle:
          - KNN performs open-set distance metric verification against enrolled templates.
            If KNN rejects the candidate (knn_known is False), the person is UNKNOWN.
            A closed-set classifier (SVM) cannot override an open-set template rejection.
          - If KNN confirms an enrolled template match:
              * If SVM agrees on the same user -> high confidence ensemble match (boosted).
              * If SVM disagrees or is unavailable -> trust KNN metric.
        """
        svm_known = svm_result and svm_result.get("is_known", False)
        knn_known = knn_result and knn_result.get("is_known", False)

        svm_user = svm_result.get("predicted_user", "unknown") if svm_result else "unknown"
        knn_user = knn_result.get("predicted_user", "unknown") if knn_result else "unknown"
        svm_conf = float(svm_result.get("confidence", 0.0)) if svm_result else 0.0
        knn_conf = float(knn_result.get("confidence", 0.0)) if knn_result else 0.0

        merged_top_k = self._merge_top_k(
            svm_result.get("top_k", []) if svm_result else [],
            knn_result.get("top_k", []) if knn_result else [],
        )

        threshold = self.ensemble.confidence_threshold  # default 0.72

        # 1. KNN template matcher is active
        if knn_result is not None and self.knn_ready:
            if not knn_known or knn_conf < threshold or knn_user == "unknown":
                # Rejected by open-set template matching -> Strictly UNKNOWN
                return {
                    "predicted_user": "unknown",
                    "confidence": round(knn_conf, 4),
                    "is_known": False,
                    "method": "knn_rejected",
                    "svm_prediction": svm_result,
                    "knn_prediction": knn_result,
                    "top_k": merged_top_k,
                }

            # KNN verified an enrolled user match
            if svm_user != "unknown" and svm_user == knn_user:
                # Both models agree -> Boosted ensemble confidence
                fused_conf = min(max((svm_conf + knn_conf) / 2.0 + 0.05, knn_conf), 0.99)
                return {
                    "predicted_user": knn_user,
                    "confidence": round(fused_conf, 4),
                    "is_known": True,
                    "method": "svm+knn",
                    "svm_prediction": svm_result,
                    "knn_prediction": knn_result,
                    "top_k": merged_top_k,
                }

            # KNN verified match (SVM may differ or be unavailable)
            return {
                "predicted_user": knn_user,
                "confidence": round(knn_conf, 4),
                "is_known": True,
                "method": "knn",
                "svm_prediction": svm_result,
                "knn_prediction": knn_result,
                "top_k": merged_top_k,
            }

        # 2. Fallback when KNN templates are not loaded (e.g. cold start)
        if svm_known and svm_conf >= 0.85 and svm_user != "unknown":
            return {
                "predicted_user": svm_user,
                "confidence": round(svm_conf, 4),
                "is_known": True,
                "method": "svm",
                "svm_prediction": svm_result,
                "knn_prediction": knn_result,
                "top_k": merged_top_k,
            }

        return {
            "predicted_user": "unknown",
            "confidence": round(max(svm_conf, knn_conf), 4),
            "is_known": False,
            "method": "none",
            "svm_prediction": svm_result,
            "knn_prediction": knn_result,
            "top_k": merged_top_k,
        }

    @staticmethod
    def _merge_top_k(svm_top: List[Dict], knn_top: List[Dict], limit: int = 5) -> List[Dict]:
        """Merge and deduplicate top-k candidates from both models."""
        scores: Dict[str, float] = {}
        for c in svm_top:
            uid = c.get("user_id", "")
            scores[uid] = scores.get(uid, 0.0) + float(c.get("confidence", 0.0))
        for c in knn_top:
            uid = c.get("user_id", "")
            scores[uid] = scores.get(uid, 0.0) + float(c.get("confidence", 0.0))

        merged = [{"user_id": uid, "confidence": score} for uid, score in scores.items()]
        merged.sort(key=lambda x: x["confidence"], reverse=True)
        return merged[:limit]

    def update_weights(self, svm_weight: float, lstm_weight: float):
        """Update ensemble fusion weights."""
        self.ensemble.svm_weight = svm_weight
        self.ensemble.lstm_weight = lstm_weight
        log.info("weights_updated", svm=svm_weight, lstm=lstm_weight)

    def update_threshold(self, threshold: float):
        """Update confidence threshold."""
        self.ensemble.confidence_threshold = threshold
        log.info("threshold_updated", threshold=threshold)
