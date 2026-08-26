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
        """Fuse SVM ensemble and KNN template predictions.

        Strategy:
          - Both agree on same user → high confidence (boosted)
          - Only one is confident  → use that one
          - They disagree          → use the one with higher confidence,
                                     but reduce overall confidence
          - Neither is confident   → unknown
        """
        svm_known = svm_result and svm_result.get("is_known", False)
        knn_known = knn_result and knn_result.get("is_known", False)

        svm_user = svm_result.get("predicted_user", "unknown") if svm_result else "unknown"
        knn_user = knn_result.get("predicted_user", "unknown") if knn_result else "unknown"
        svm_conf = float(svm_result.get("confidence", 0.0)) if svm_result else 0.0
        knn_conf = float(knn_result.get("confidence", 0.0)) if knn_result else 0.0

        # Merge top_k from both models
        merged_top_k = self._merge_top_k(
            svm_result.get("top_k", []) if svm_result else [],
            knn_result.get("top_k", []) if knn_result else [],
        )

        # Case 1: Both agree on the same known user → high confidence
        if svm_known and knn_known and svm_user == knn_user:
            return {
                "predicted_user": svm_user,
                "confidence": min((svm_conf + knn_conf) / 1.5, 1.0),
                "is_known": True,
                "method": "svm+knn",
                "svm_prediction": svm_result,
                "knn_prediction": knn_result,
                "top_k": merged_top_k,
            }

        # Case 2: Both know someone but disagree → use the one with higher confidence
        if svm_known and knn_known and svm_user != knn_user:
            if knn_conf >= svm_conf:
                winner, method = knn_result, "knn>svm"
            else:
                winner, method = svm_result, "svm>knn"
            return {
                "predicted_user": winner["predicted_user"],
                "confidence": winner["confidence"] * 0.85,  # penalty for disagreement
                "is_known": True,
                "method": method,
                "svm_prediction": svm_result,
                "knn_prediction": knn_result,
                "top_k": merged_top_k,
            }

        # Case 3: Only KNN knows the person
        if knn_known and not svm_known:
            return {
                "predicted_user": knn_user,
                "confidence": knn_conf,
                "is_known": True,
                "method": "knn_only",
                "svm_prediction": svm_result,
                "knn_prediction": knn_result,
                "top_k": merged_top_k,
            }

        # Case 4: Only SVM knows the person
        if svm_known and not knn_known:
            return {
                "predicted_user": svm_user,
                "confidence": svm_conf,
                "is_known": True,
                "method": "svm_only",
                "svm_prediction": svm_result,
                "knn_prediction": knn_result,
                "top_k": merged_top_k,
            }

        # Case 5: Neither model knows — unknown
        return {
            "predicted_user": "unknown",
            "confidence": max(svm_conf, knn_conf),
            "is_known": False,
            "method": "svm+knn",
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
