"""
anomaly-detection/backend/app/ml_services/inference/rule_engine.py

Pure rule-based anomaly classification.
Works WITHOUT any trained model weights.
This is the always-on foundation layer.

Each rule function takes:
    features: np.ndarray  — feature vector from feature_engineer.py
    person_id: str        — used to access frame counters in sequence_buffer

Returns:
    dict — { "event": str, "confidence": float, "severity": str, "evidence": dict }
    Returns None if no rule fires.
"""
import numpy as np
import app.ml_services.inference.sequence_buffer as buf
from app.ml_services.utils.thresholds import (
    FALL_TORSO_ANGLE_DEG, FALL_HEAD_DROP_RATIO, FALL_PERSIST_FRAMES,
    FALL_BODY_LOW_RATIO, INACTIVITY_ENERGY_THRESHOLD,
    INACTIVITY_WARNING_SEC, INACTIVITY_ALERT_SEC, INACTIVITY_CRITICAL_SEC,
    AGGRESSION_WRIST_VELOCITY, AGGRESSION_BODY_VELOCITY,
    AGGRESSION_ENERGY_HIGH, AGGRESSION_PERSIST_FRAMES,
)

# Feature vector indices (must match feature_engineer.py output order)
_IDX_TORSO_ANGLE    = 8    # normalized by /90
_IDX_ASPECT_RATIO   = 14   # normalized by /3
_IDX_BODY_CY        = 13
_IDX_HEAD_DROP      = 21
_IDX_BODY_VELOCITY  = 18
_IDX_WRIST_L_VEL    = 19
_IDX_WRIST_R_VEL    = 20
_IDX_POSE_ENERGY    = 22
_IDX_NOSE_Y         = 24   # raw nose y position
_IDX_HIP_Y          = 37   # hip_cy raw value

# Approximate polling rate for inactivity timer
FRAMES_PER_SEC = 5   # we poll ~every 0.2 seconds (POLL_MS = 200ms on frontend)


def check_fall(features: np.ndarray, person_id: str) -> dict | None:
    """
    Fall heuristics:
      1. Torso angle > FALL_TORSO_ANGLE_DEG (person leaning/horizontal)
      2. Head drop speed above threshold (rapid downward movement)
      3. Body centre y is high in frame (near floor)
      4. Aspect ratio low (wide/horizontal body shape)
    Must persist for FALL_PERSIST_FRAMES consecutive frames.
    """
    torso_angle_normalised = features[_IDX_TORSO_ANGLE]     # 0-1 (1 = 90°)
    actual_torso_angle = torso_angle_normalised * 90.0

    aspect_ratio  = features[_IDX_ASPECT_RATIO] * 3.0       # restore scale
    head_drop     = features[_IDX_HEAD_DROP]                 # +ve = dropping
    body_cy       = features[_IDX_BODY_CY]                   # 0-1 vertical position

    # Composite fall signature
    torso_fallen   = actual_torso_angle > FALL_TORSO_ANGLE_DEG
    body_low       = body_cy > FALL_BODY_LOW_RATIO
    rapid_drop     = head_drop > FALL_HEAD_DROP_RATIO
    horizontal     = aspect_ratio < 1.0   # wider than tall

    is_fall_frame = torso_fallen and (body_low or horizontal or rapid_drop)

    if is_fall_frame:
        count = buf.increment_counter(person_id, "fall_frames")
        if count >= FALL_PERSIST_FRAMES:
            confidence = min(0.65 + (count / (FALL_PERSIST_FRAMES * 3)) * 0.35, 0.99)
            return {
                "event":      "fall_detected",
                "confidence": round(confidence, 3),
                "severity":   "critical",
                "source":     "rule_engine",
                "evidence": {
                    "torso_angle":   round(actual_torso_angle, 1),
                    "body_cy":       round(float(body_cy), 3),
                    "aspect_ratio":  round(float(aspect_ratio), 3),
                    "fall_frames":   count,
                },
            }
    else:
        buf.reset_counter(person_id, "fall_frames")

    return None


def check_inactivity(features: np.ndarray, person_id: str) -> dict | None:
    """
    Inactivity heuristics:
      Person is visible but total pose energy is below threshold
      for an extended number of frames (converted to seconds).
    """
    pose_energy = features[_IDX_POSE_ENERGY]

    if pose_energy < INACTIVITY_ENERGY_THRESHOLD:
        count = buf.increment_counter(person_id, "inactivity_frames")
        seconds = count / FRAMES_PER_SEC

        if seconds >= INACTIVITY_CRITICAL_SEC:
            return {
                "event":      "prolonged_inactivity",
                "confidence": min(0.70 + seconds / 300, 0.99),
                "severity":   "critical",
                "source":     "rule_engine",
                "evidence": {
                    "inactivity_seconds": round(seconds, 1),
                    "pose_energy":        round(float(pose_energy), 5),
                },
            }
        elif seconds >= INACTIVITY_ALERT_SEC:
            return {
                "event":      "prolonged_inactivity",
                "confidence": 0.70,
                "severity":   "high",
                "source":     "rule_engine",
                "evidence": {
                    "inactivity_seconds": round(seconds, 1),
                    "pose_energy":        round(float(pose_energy), 5),
                },
            }
        elif seconds >= INACTIVITY_WARNING_SEC:
            return {
                "event":      "inactivity_warning",
                "confidence": 0.55,
                "severity":   "medium",
                "source":     "rule_engine",
                "evidence": {
                    "inactivity_seconds": round(seconds, 1),
                    "pose_energy":        round(float(pose_energy), 5),
                },
            }
    else:
        buf.reset_counter(person_id, "inactivity_frames")

    return None


def check_aggression(features: np.ndarray, person_id: str) -> dict | None:
    """
    Aggression heuristics:
      Fast repeated arm velocity + high overall body motion energy.
      Must persist for AGGRESSION_PERSIST_FRAMES consecutive frames.
    """
    wrist_l_vel   = features[_IDX_WRIST_L_VEL]
    wrist_r_vel   = features[_IDX_WRIST_R_VEL]
    body_velocity = features[_IDX_BODY_VELOCITY]
    pose_energy   = features[_IDX_POSE_ENERGY]

    max_wrist_vel = max(wrist_l_vel, wrist_r_vel)

    is_aggression_frame = (
        max_wrist_vel   > AGGRESSION_WRIST_VELOCITY and
        (body_velocity > AGGRESSION_BODY_VELOCITY or pose_energy > AGGRESSION_ENERGY_HIGH)
    )

    if is_aggression_frame:
        count = buf.increment_counter(person_id, "aggression_frames")
        if count >= AGGRESSION_PERSIST_FRAMES:
            confidence = min(0.60 + (count / (AGGRESSION_PERSIST_FRAMES * 4)) * 0.35, 0.95)
            return {
                "event":      "aggression_detected",
                "confidence": round(confidence, 3),
                "severity":   "high",
                "source":     "rule_engine",
                "evidence": {
                    "wrist_velocity":   round(float(max_wrist_vel), 4),
                    "body_velocity":    round(float(body_velocity), 4),
                    "pose_energy":      round(float(pose_energy), 4),
                    "aggression_frames": count,
                },
            }
    else:
        buf.reset_counter(person_id, "aggression_frames")

    return None


def evaluate(features: np.ndarray, person_id: str) -> dict:
    """
    Run all rules in priority order.
    Fall > Aggression > Inactivity
    Returns structured result including normal_activity if nothing fires.
    """
    # Priority 1: Fall (most urgent)
    result = check_fall(features, person_id)
    if result:
        return result

    # Priority 2: Aggression
    result = check_aggression(features, person_id)
    if result:
        return result

    # Priority 3: Inactivity
    result = check_inactivity(features, person_id)
    if result:
        return result

    # No anomaly
    return {
        "event":      "normal_activity",
        "confidence": 1.0,
        "severity":   "none",
        "source":     "rule_engine",
        "evidence":   {
            "pose_energy": round(float(features[_IDX_POSE_ENERGY]), 5),
        },
    }
