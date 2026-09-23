"""
services/identification/models/template_knn.py
Compatibility wrapper delegating to BiometricTemplateMatcher.
"""
from typing import Dict, List, Any, Optional
import numpy as np

from .biometric_template import BiometricTemplateMatcher


class TemplateIdentifier:
    """Delegates to BiometricTemplateMatcher for high-accuracy open-set biometric identification."""

    def __init__(self, acceptance_threshold: float = 0.70):
        self.matcher = BiometricTemplateMatcher(acceptance_threshold=acceptance_threshold)

    @property
    def is_ready(self) -> bool:
        return self.matcher.is_ready

    @property
    def templates(self) -> Dict[str, Any]:
        return self.matcher.templates

    def load_from_profiles(self, profiles: List[Dict]) -> int:
        return self.matcher.load_from_profiles(profiles)

    def identify(self, feature_vector: np.ndarray, top_k: int = 5) -> Dict[str, Any]:
        return self.matcher.identify(feature_vector, top_k=top_k)

    @classmethod
    def normalize_vector(cls, v: Any) -> np.ndarray:
        from services.feature_extraction.static_features import StaticFeatureExtractor
        return StaticFeatureExtractor.normalize_vector(v)
