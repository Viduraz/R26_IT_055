"""
services/identification/predictor.py
Hybrid Open-Set Biometric Identifier.

Combines:
  1. Static Anthropometric Prototype Matcher (Regularized Mahalanobis Distance on Invariant Ratios)
  2. Temporal Gait Motion Branch (PyTorch LSTM sequence model)
  3. Multi-modal Decision Fusion (Open-set rejection + Same-pose ambiguity resolution)
"""
import numpy as np
import time
import structlog
from pathlib import Path
from typing import Dict, Any, Optional, List

from .models.biometric_template import BiometricTemplateMatcher
from .models.lstm_model import SkeletonLSTM
from .models.ensemble import EnsembleIdentifier
from .fusion import DecisionFusion

log = structlog.get_logger()


class Predictor:
    """Hybrid Biometric Person Identifier with Open-Set Stranger Rejection."""

    def __init__(
        self,
        model_dir: str = "./models",
        acceptance_threshold: float = 0.70,
        ambiguity_margin: float = 0.04,
        static_weight: float = 0.65,
        temporal_weight: float = 0.35,
        svm_weight: Optional[float] = None,
        lstm_weight: Optional[float] = None,
        confidence_threshold: Optional[float] = None,
        **kwargs,
    ):
        if confidence_threshold is not None:
            acceptance_threshold = confidence_threshold
        if svm_weight is not None:
            static_weight = svm_weight
        if lstm_weight is not None:
            temporal_weight = lstm_weight

        self.model_dir = model_dir
        self.matcher = BiometricTemplateMatcher(
            acceptance_threshold=acceptance_threshold,
            ambiguity_margin=ambiguity_margin,
        )
        self.temporal_model = SkeletonLSTM()
        self.fusion = DecisionFusion(
            static_weight=static_weight,
            temporal_weight=temporal_weight,
            confidence_threshold=acceptance_threshold,
            ambiguity_margin=ambiguity_margin,
        )
        # Retain legacy ensemble instance for optional auxiliary signals
        self.ensemble = EnsembleIdentifier(confidence_threshold=acceptance_threshold)
        self._models_loaded = False

    def load_models(self) -> bool:
        """Load trained auxiliary models from disk."""
        path = Path(self.model_dir)
        if not path.exists():
            log.warning("model_dir_not_found", path=str(path))
            return False

        try:
            self.ensemble.load(self.model_dir)
            if (path / "lstm_model.pt").exists():
                try:
                    self.temporal_model.load(self.model_dir)
                except Exception as e:
                    log.warning("temporal_lstm_load_warning", error=str(e))
            self._models_loaded = True
            log.info("models_loaded", svm=self.ensemble.svm_ready, lstm=self.temporal_model.is_trained)
            return True
        except Exception as e:
            log.warning("model_load_partial", error=str(e))
            return False

    def load_knn_templates(self, profiles: List[Dict]) -> int:
        """Load biometric templates from feature profile records.

        Profiles come from MongoDB only. The former fallback that read
        ./data/local_db.json off disk is gone: it could quietly identify people
        against stale enrollments that no longer existed in the database.
        """
        if not profiles:
            log.warning("no_feature_profiles_to_load")
        return self.matcher.load_from_profiles(profiles)

    @property
    def is_ready(self) -> bool:
        """System is ready if biometric templates are loaded."""
        return self.matcher.is_ready or (self._models_loaded and self.ensemble.is_trained)

    @property
    def knn_ready(self) -> bool:
        return self.matcher.is_ready

    @property
    def knn(self):
        """Backward compatibility access to template matcher."""
        return self.matcher

    def identify(
        self,
        static_features: Optional[np.ndarray] = None,
        gait_sequence: Optional[np.ndarray] = None,
        is_moving: bool = False,
        top_k: int = 5,
    ) -> Dict[str, Any]:
        """Execute hybrid open-set person identification.

        Args:
            static_features: 24-dim pure anthropometric feature vector
            gait_sequence: (30, 8) temporal joint angle sequence (optional)
            is_moving: Boolean flag indicating if subject is in active walking motion
            top_k: Number of top candidate identities to return

        Returns:
            Structured decision dictionary with timing diagnostics
        """
        t_start = time.perf_counter()

        if not self.is_ready:
            return {
                "predicted_user": "unknown",
                "confidence": 0.0,
                "is_known": False,
                "status": "UNKNOWN",
                "reason": "Biometric templates not loaded",
                "method": "none",
                "latency_ms": 0.0,
                "benchmarks": {},
                "top_k": [],
            }

        # ── 1. Static Anthropometric Branch ────────────────────────────────────
        t_static_start = time.perf_counter()
        static_result = None
        if self.matcher.is_ready and static_features is not None:
            static_result = self.matcher.identify(
                feature_vector=static_features,
                top_k=top_k,
            )
        static_latency = (time.perf_counter() - t_static_start) * 1000

        # ── 2. Temporal Motion Branch ──────────────────────────────────────────
        t_temporal_start = time.perf_counter()
        temporal_result = None
        if gait_sequence is not None and self.temporal_model.is_trained:
            try:
                temporal_result = self.temporal_model.predict(
                    sequence=gait_sequence,
                    top_k=top_k,
                )
            except Exception as exc:
                log.debug("temporal_prediction_skipped", error=str(exc))
        temporal_latency = (time.perf_counter() - t_temporal_start) * 1000

        # ── 3. Decision Fusion ─────────────────────────────────────────────────
        decision = self.fusion.fuse(
            static_result=static_result,
            temporal_result=temporal_result,
            is_moving=is_moving,
        )

        total_latency = (time.perf_counter() - t_start) * 1000
        decision["latency_ms"] = round(total_latency, 2)
        decision["benchmarks"] = {
            "static_match_ms": round(static_latency, 2),
            "temporal_match_ms": round(temporal_latency, 2),
            "total_inference_ms": round(total_latency, 2),
        }

        return decision
