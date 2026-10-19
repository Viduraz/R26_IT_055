"""
services/identification/fusion.py
Multi-modal Decision Fusion Engine.

Fuses static anthropometric prototype evidence with temporal motion / gait dynamics
to produce robust open-set person identification decisions.

Explicitly handles:
  - KNOWN: Confident identification supported by biometrics and/or motion corroboration
  - UNKNOWN: Stranger rejection outside learned thresholds
  - AMBIGUOUS: Borderline candidates (e.g. identical standing poses) awaiting motion corroboration
  - INSUFFICIENT_DATA: Missing or poor-quality skeleton frames
"""
import numpy as np
import structlog
from typing import Dict, List, Any, Optional

log = structlog.get_logger()


class DecisionFusion:
    """Combines static anthropometric and temporal gait evidence into an authoritative biometric decision."""

    def __init__(
        self,
        static_weight: float = 0.65,
        temporal_weight: float = 0.35,
        confidence_threshold: float = 0.70,
        ambiguity_margin: float = 0.04,
    ):
        self.static_weight = static_weight
        self.temporal_weight = temporal_weight
        self.confidence_threshold = confidence_threshold
        self.ambiguity_margin = ambiguity_margin

    def fuse(
        self,
        static_result: Optional[Dict[str, Any]],
        temporal_result: Optional[Dict[str, Any]] = None,
        is_moving: bool = False,
    ) -> Dict[str, Any]:
        """Fuse static and temporal branches.

        Args:
            static_result: Output from BiometricTemplateMatcher
            temporal_result: Output from SkeletonLSTM (or None if standing/static)
            is_moving: Whether subject is actively walking/moving
        """
        if not static_result:
            return {
                "predicted_user": "unknown",
                "confidence": 0.0,
                "is_known": False,
                "status": "INSUFFICIENT_DATA",
                "reason": "No valid static biometric evidence",
                "method": "none",
                "top_k": [],
            }

        s_user = static_result.get("predicted_user", "unknown")
        s_conf = float(static_result.get("confidence", 0.0))
        s_known = bool(static_result.get("is_known", False))
        s_status = static_result.get("status", "UNKNOWN")
        s_ambiguous = bool(static_result.get("is_ambiguous", False))
        top_k = static_result.get("top_k", [])

        t_user = temporal_result.get("predicted_user", "unknown") if temporal_result else "unknown"
        t_conf = float(temporal_result.get("confidence", 0.0)) if temporal_result else 0.0
        t_known = bool(temporal_result.get("is_known", False)) if temporal_result else False

        # ── Case 1: Stranger Rejection (Open-Set Thresholding) ─────────────────
        # Checked *after* ambiguity below, because an ambiguous pair also scores
        # under the acceptance threshold; testing the threshold first would
        # report "unregistered visitor" for two enrolled users the matcher simply
        # could not tell apart, and hide the real reason from the operator.
        if not s_ambiguous and (
            s_status == "UNKNOWN" or s_conf < self.confidence_threshold or s_user == "unknown"
        ):
            return {
                "predicted_user": "unknown",
                "confidence": round(s_conf, 4),
                "is_known": False,
                "status": "UNKNOWN",
                "reason": "Anthropometric proportions outside enrolled thresholds (Unauthorized visitor)",
                "method": "anthropometric_rejected",
                "static_result": static_result,
                "temporal_result": temporal_result,
                "top_k": top_k,
            }

        # ── Case 2: Ambiguous Static Match (Same-Pose / Close Candidates) ─────
        if s_ambiguous:
            # Check if temporal motion evidence resolves the ambiguity
            if temporal_result and t_known and t_user != "unknown":
                # Check if temporal candidate matches one of the top static candidates
                top_candidate_ids = [c.get("user_id") for c in top_k[:2]]
                if t_user in top_candidate_ids:
                    # Ambiguity successfully resolved by temporal motion corroboration
                    fused_conf = min(max(s_conf * 0.5 + t_conf * 0.5 + 0.05, 0.75), 0.99)
                    return {
                        "predicted_user": t_user,
                        "confidence": round(fused_conf, 4),
                        "is_known": True,
                        "status": "KNOWN",
                        "reason": "Static ambiguity resolved by temporal motion corroboration",
                        "method": "static+temporal_resolved",
                        "static_result": static_result,
                        "temporal_result": temporal_result,
                        "top_k": top_k,
                    }

            # Temporal evidence not yet available or inconclusive -> Report AMBIGUOUS
            return {
                "predicted_user": s_user,
                "confidence": round(s_conf, 4),
                "is_known": False,
                "status": "AMBIGUOUS",
                "reason": "Borderline body proportions between enrolled users; awaiting movement verification",
                "method": "ambiguous_collecting_motion",
                "static_result": static_result,
                "temporal_result": temporal_result,
                "top_k": top_k,
            }

        # ── Case 3: Confident Static Match (Agreement & Boost) ─────────────────
        if s_known and s_user != "unknown":
            if temporal_result and t_known and t_user == s_user:
                # Both static and temporal motion agree on the same identity
                fused_conf = min(max(self.static_weight * s_conf + self.temporal_weight * t_conf + 0.05, s_conf), 0.99)
                method_name = "static+gait_ensemble"
                reason_str = "High-confidence anthropometric match confirmed by gait dynamics"
            else:
                fused_conf = s_conf
                method_name = "anthropometric_prototype"
                reason_str = "Verified anthropometric match"

            return {
                "predicted_user": s_user,
                "confidence": round(fused_conf, 4),
                "is_known": True,
                "status": "KNOWN",
                "reason": reason_str,
                "method": method_name,
                "static_result": static_result,
                "temporal_result": temporal_result,
                "top_k": top_k,
            }

        # Default fallback: Unknown
        return {
            "predicted_user": "unknown",
            "confidence": round(s_conf, 4),
            "is_known": False,
            "status": "UNKNOWN",
            "reason": "Inconclusive biometric evidence",
            "method": "fallback_unknown",
            "static_result": static_result,
            "temporal_result": temporal_result,
            "top_k": top_k,
        }
