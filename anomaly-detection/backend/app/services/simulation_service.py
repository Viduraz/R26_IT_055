"""
anomaly-detection/backend/app/services/simulation_service.py

Scenario Mode (Phase 3) — Demo Simulation Service

Allows the presenter to inject synthetic anomaly events directly into the
system during a live demonstration, without needing a real camera to produce
the exact body posture.

This is the "secret weapon" for viva presentations:
    - Full control over what the system detects
    - Consistent, reproducible demo scenarios
    - Safe for live demonstration in exam environments

Endpoints that use this:
    POST /api/anomaly/simulate/fall
    POST /api/anomaly/simulate/aggression
    POST /api/anomaly/simulate/inactivity
    POST /api/anomaly/simulate/normal
    POST /api/anomaly/simulate/reset

Each scenario returns a full anomaly event dict identical in structure to a
real detection — including explanation, contributing_factors, evidence, etc.
"""
import time
from datetime import datetime, timezone

# Synthetic skeleton keypoints (33 landmarks, normalised 0-1)
# These are hand-crafted to represent each scenario for canvas drawing.
_STANDING_KPTS = [
    # nose, eyes, ears (0–10)
    [0.50, 0.12, 0.98], [0.51, 0.11, 0.97], [0.49, 0.11, 0.97],
    [0.53, 0.11, 0.96], [0.47, 0.11, 0.96], [0.55, 0.12, 0.90],
    [0.45, 0.12, 0.90], [0.56, 0.12, 0.85], [0.44, 0.12, 0.85],
    [0.55, 0.13, 0.80], [0.45, 0.13, 0.80],
    # shoulders (11–12)
    [0.42, 0.25, 0.99], [0.58, 0.25, 0.99],
    # elbows (13–14)
    [0.38, 0.40, 0.98], [0.62, 0.40, 0.98],
    # wrists (15–16)
    [0.36, 0.55, 0.97], [0.64, 0.55, 0.97],
    # pinky, index, thumb (17–22)
    [0.35, 0.57, 0.80], [0.65, 0.57, 0.80],
    [0.34, 0.57, 0.75], [0.66, 0.57, 0.75],
    [0.35, 0.56, 0.75], [0.65, 0.56, 0.75],
    # hips (23–24)
    [0.45, 0.55, 0.99], [0.55, 0.55, 0.99],
    # knees (25–26)
    [0.44, 0.72, 0.98], [0.56, 0.72, 0.98],
    # ankles (27–28)
    [0.44, 0.88, 0.97], [0.56, 0.88, 0.97],
    # heels + foot toes (29–32)
    [0.43, 0.90, 0.85], [0.57, 0.90, 0.85],
    [0.42, 0.91, 0.80], [0.58, 0.91, 0.80],
]

_FALL_KPTS = [
    # Horizontal/fallen posture — body spread wide and low
    [0.50, 0.75, 0.90], [0.51, 0.74, 0.88], [0.49, 0.74, 0.88],
    [0.53, 0.74, 0.86], [0.47, 0.74, 0.86], [0.55, 0.75, 0.80],
    [0.45, 0.75, 0.80], [0.56, 0.75, 0.75], [0.44, 0.75, 0.75],
    [0.55, 0.76, 0.70], [0.45, 0.76, 0.70],
    [0.38, 0.68, 0.95], [0.62, 0.68, 0.95],  # shoulders spread
    [0.28, 0.72, 0.90], [0.72, 0.72, 0.90],  # elbows spread
    [0.20, 0.78, 0.88], [0.80, 0.78, 0.88],  # wrists spread
    [0.19, 0.79, 0.70], [0.81, 0.79, 0.70],
    [0.18, 0.79, 0.65], [0.82, 0.79, 0.65],
    [0.19, 0.78, 0.65], [0.81, 0.78, 0.65],
    [0.44, 0.80, 0.98], [0.56, 0.80, 0.98],  # hips low
    [0.40, 0.84, 0.92], [0.60, 0.84, 0.92],
    [0.38, 0.88, 0.88], [0.62, 0.88, 0.88],
    [0.37, 0.89, 0.78], [0.63, 0.89, 0.78],
    [0.36, 0.90, 0.72], [0.64, 0.90, 0.72],
]

_AGGRESSION_KPTS = [
    # Raised arms, wide stance — aggressive posture
    [0.50, 0.12, 0.98], [0.51, 0.11, 0.97], [0.49, 0.11, 0.97],
    [0.53, 0.11, 0.96], [0.47, 0.11, 0.96], [0.55, 0.12, 0.90],
    [0.45, 0.12, 0.90], [0.56, 0.12, 0.85], [0.44, 0.12, 0.85],
    [0.55, 0.13, 0.80], [0.45, 0.13, 0.80],
    [0.40, 0.25, 0.99], [0.60, 0.25, 0.99],
    [0.30, 0.15, 0.98], [0.70, 0.15, 0.98],  # elbows raised
    [0.20, 0.08, 0.97], [0.80, 0.08, 0.97],  # wrists high = raised fists
    [0.19, 0.07, 0.80], [0.81, 0.07, 0.80],
    [0.18, 0.07, 0.75], [0.82, 0.07, 0.75],
    [0.19, 0.08, 0.75], [0.81, 0.08, 0.75],
    [0.43, 0.55, 0.99], [0.57, 0.55, 0.99],
    [0.40, 0.72, 0.98], [0.60, 0.72, 0.98],  # wide stance
    [0.38, 0.88, 0.97], [0.62, 0.88, 0.97],
    [0.37, 0.90, 0.85], [0.63, 0.90, 0.85],
    [0.36, 0.91, 0.80], [0.64, 0.91, 0.80],
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _base_event(anomaly_type: str, confidence: float, severity: str,
                keypoints: list, bbox: dict) -> dict:
    """Build a fully-formed event dict matching real detection output."""
    return {
        "anomaly_type": anomaly_type,
        "confidence":   confidence,
        "severity":     severity,
        "source":       "simulation",
        "lstm_used":    True,
        "ae_used":      True,
        "ae_error":     0.05,
        "rule_event":   anomaly_type,
        "pose_valid":   True,
        "smoothed":     True,
        "simulated":    True,
        "timestamp":    _now(),
        "keypoints":    keypoints,
        "bbox":         bbox,
        "evidence":     {},
    }


def simulate_fall(person_id: str = "demo_patient") -> dict:
    evt = _base_event(
        anomaly_type = "fall_detected",
        confidence   = 0.93,
        severity     = "critical",
        keypoints    = _FALL_KPTS,
        bbox         = {"x": 0.15, "y": 0.60, "w": 0.70, "h": 0.35},
    )
    evt["evidence"] = {
        "torso_angle":   72.5,
        "body_cy":       0.78,
        "aspect_ratio":  0.38,
        "fall_frames":   4,
        "pose_energy":   0.18,
        "wrist_velocity": 0.09,
    }
    evt["explanation"] = {
        "reason": (
            "Fall detected: torso tilted 72° from vertical; "
            "body centre dropped to 78% of frame height; "
            "body aspect ratio 0.38 (horizontal posture); "
            "confirmed across 4 consecutive frames"
        ),
        "contributing_factors": {
            "torso_tilt_score":      0.91,
            "pose_drop_score":       0.87,
            "horizontal_posture":    0.82,
            "temporal_confirmation": 4,
            "lstm_probability":      0.93,
            "ae_reconstruction_error": 0.047,
        },
        "signal_breakdown": {
            "rule_engine": 0.87,
            "temporal":    0.80,
            "lstm":        0.93,
            "autoencoder": 0.72,
        },
        "temporal_confirmation": 4,
    }
    evt["person_id"] = person_id
    return evt


def simulate_aggression(person_id: str = "demo_patient") -> dict:
    evt = _base_event(
        anomaly_type = "aggression_detected",
        confidence   = 0.81,
        severity     = "high",
        keypoints    = _AGGRESSION_KPTS,
        bbox         = {"x": 0.18, "y": 0.05, "w": 0.64, "h": 0.88},
    )
    evt["evidence"] = {
        "wrist_velocity":    0.147,
        "body_velocity":     0.062,
        "pose_energy":       0.231,
        "aggression_frames": 3,
    }
    evt["explanation"] = {
        "reason": (
            "Aggression detected: wrist velocity 0.147 (rapid arm movement); "
            "overall body velocity 0.062; "
            "high pose energy 0.231; "
            "sustained across 3 frames"
        ),
        "contributing_factors": {
            "wrist_velocity":        0.83,
            "body_velocity":         0.71,
            "pose_energy_score":     0.88,
            "temporal_confirmation": 3,
            "lstm_probability":      0.81,
        },
        "signal_breakdown": {
            "rule_engine": 0.81,
            "temporal":    0.75,
            "lstm":        0.81,
            "autoencoder": 0.61,
        },
        "temporal_confirmation": 3,
    }
    evt["person_id"] = person_id
    return evt


def simulate_inactivity(person_id: str = "demo_patient") -> dict:
    evt = _base_event(
        anomaly_type = "prolonged_inactivity",
        confidence   = 0.78,
        severity     = "high",
        keypoints    = _STANDING_KPTS,
        bbox         = {"x": 0.30, "y": 0.10, "w": 0.40, "h": 0.82},
    )
    evt["evidence"] = {
        "inactivity_seconds": 45.0,
        "pose_energy":        0.0004,
    }
    evt["explanation"] = {
        "reason": (
            "Inactivity alert (prolonged): no significant movement for 45 seconds; "
            "pose energy at 0.00040 (below motion threshold)"
        ),
        "contributing_factors": {
            "inactivity_duration_sec": 45.0,
            "motion_energy":           0.00040,
            "stillness_score":         0.98,
            "temporal_confirmation":   225,
            "lstm_probability":        0.78,
        },
        "signal_breakdown": {
            "rule_engine": 0.75,
            "temporal":    0.38,
            "lstm":        0.78,
            "autoencoder": 0.0,
        },
        "temporal_confirmation": 225,
    }
    evt["person_id"] = person_id
    return evt


def simulate_normal(person_id: str = "demo_patient") -> dict:
    evt = _base_event(
        anomaly_type = "normal_activity",
        confidence   = 1.0,
        severity     = "none",
        keypoints    = _STANDING_KPTS,
        bbox         = {"x": 0.30, "y": 0.10, "w": 0.40, "h": 0.82},
    )
    evt["evidence"] = {"pose_energy": 0.018}
    evt["explanation"] = {
        "reason": "Normal activity: all rule thresholds clear, pose energy within expected range.",
        "contributing_factors": {"pose_energy": 0.018},
        "signal_breakdown": {"rule_engine": 0.0, "temporal": 0.0, "lstm": 0.0, "autoencoder": 0.0},
        "temporal_confirmation": 0,
    }
    evt["person_id"] = person_id
    return evt
