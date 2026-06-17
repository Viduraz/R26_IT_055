"""
anomaly-detection/backend/app/ml_services/inference/decision_explainer.py

Intelligence Layer — "WHY did this anomaly trigger?"

Generates structured human-readable explanations and a ranked list of
contributing factors for every detected anomaly event.

This module is purely analytical — it does NOT change the detection outcome.
It reads the rule evidence, LSTM output, and AE error and synthesises:
  - A plain-English reason string
  - A dict of contributing_factors with normalised 0-1 strength scores
  - A confidence breakdown by detection source

Designed specifically for research viva demonstrations.
"""
from __future__ import annotations
import math


# ── Public entry point ────────────────────────────────────────────────────────

def explain(
    anomaly_type: str,
    rule_result:  dict,
    lstm_result:  dict | None,
    ae_error:     float | None,
    features_snapshot: dict | None = None,
) -> dict:
    """
    Build a decision explanation for the given anomaly event.

    Args:
        anomaly_type:      Final classified event type.
        rule_result:       Output of rule_engine.evaluate()
        lstm_result:       Output of lstm_model.predict() or None
        ae_error:          AE reconstruction error or None
        features_snapshot: Optional dict of named feature values (from engineer)

    Returns:
        {
            "reason":               str  — plain English explanation
            "contributing_factors": dict — named signal strengths (0-1)
            "signal_breakdown":     dict — source contributions
            "temporal_confirmation": int — frames that confirmed the event
        }
    """
    ev       = rule_result.get("evidence", {}) if rule_result else {}
    src      = rule_result.get("source", "rule_engine") if rule_result else "unknown"
    r_event  = rule_result.get("event",  "normal_activity") if rule_result else "normal_activity"

    if anomaly_type == "fall_detected":
        return _explain_fall(ev, lstm_result, ae_error)

    if anomaly_type in ("aggression_detected",):
        return _explain_aggression(ev, lstm_result, ae_error)

    if anomaly_type in ("prolonged_inactivity", "inactivity_warning"):
        return _explain_inactivity(ev, anomaly_type, lstm_result)

    if anomaly_type == "unusual_movement":
        return _explain_unusual(ae_error)

    # Normal activity — still provide a brief explanation
    return _explain_normal(ev)


# ── Per-event explainers ──────────────────────────────────────────────────────

def _explain_fall(ev: dict, lstm_result, ae_error) -> dict:
    torso     = ev.get("torso_angle",  0.0)
    body_cy   = ev.get("body_cy",      0.5)
    aspect    = ev.get("aspect_ratio", 1.0)
    frames    = ev.get("fall_frames",  0)

    # Compute signal strengths
    torso_strength  = _sigmoid_scale(torso,   centre=55.0, scale=0.12)
    drop_strength   = _sigmoid_scale(body_cy,  centre=0.65, scale=10.0)
    horiz_strength  = _sigmoid_scale(1.0 - aspect, centre=0.3, scale=8.0)
    temporal_score  = min(frames / 5.0, 1.0)
    lstm_strength   = lstm_result["prob"] if lstm_result and lstm_result["class"] == "fall_detected" else 0.0
    ae_strength     = _sigmoid_scale(ae_error or 0.0, centre=0.08, scale=15.0)

    # Build reason string
    parts = []
    if torso >= 45:   parts.append(f"torso tilted {torso:.0f}° from vertical")
    if body_cy > 0.6: parts.append(f"body centre dropped to {body_cy:.0%} of frame height")
    if aspect < 1.0:  parts.append(f"body aspect ratio {aspect:.2f} (horizontal posture)")
    if frames >= 3:   parts.append(f"confirmed across {frames} consecutive frames")
    if lstm_strength > 0.5: parts.append(f"LSTM corroborated (p={lstm_result['prob']:.2f})")

    reason = "Fall detected: " + "; ".join(parts) if parts else "Fall posture pattern identified."

    return {
        "reason": reason,
        "contributing_factors": {
            "torso_tilt_score":       round(torso_strength,  3),
            "pose_drop_score":        round(drop_strength,   3),
            "horizontal_posture":     round(horiz_strength,  3),
            "temporal_confirmation":  frames,
            "lstm_probability":       round(lstm_strength,   3),
            "ae_reconstruction_error": round(ae_error or 0.0, 5),
        },
        "signal_breakdown": {
            "rule_engine": round((torso_strength + drop_strength + horiz_strength) / 3, 3),
            "temporal":    round(temporal_score, 3),
            "lstm":        round(lstm_strength,  3),
            "autoencoder": round(ae_strength,    3),
        },
        "temporal_confirmation": frames,
    }


def _explain_aggression(ev: dict, lstm_result, ae_error) -> dict:
    wrist_vel  = ev.get("wrist_velocity",    0.0)
    body_vel   = ev.get("body_velocity",     0.0)
    energy     = ev.get("pose_energy",       0.0)
    frames     = ev.get("aggression_frames", 0)

    wrist_s  = _sigmoid_scale(wrist_vel, centre=0.08, scale=25.0)
    body_s   = _sigmoid_scale(body_vel,  centre=0.04, scale=40.0)
    energy_s = _sigmoid_scale(energy,    centre=0.15, scale=15.0)
    lstm_s   = lstm_result["prob"] if lstm_result and lstm_result["class"] == "aggression_detected" else 0.0

    parts = []
    if wrist_vel > 0.05: parts.append(f"wrist velocity {wrist_vel:.3f} (rapid arm movement)")
    if body_vel  > 0.03: parts.append(f"overall body velocity {body_vel:.3f}")
    if energy    > 0.12: parts.append(f"high pose energy {energy:.3f}")
    if frames    >= 2:   parts.append(f"sustained across {frames} frames")

    reason = "Aggression detected: " + "; ".join(parts) if parts else "Rapid repetitive movement pattern detected."

    return {
        "reason": reason,
        "contributing_factors": {
            "wrist_velocity":        round(wrist_s,  3),
            "body_velocity":         round(body_s,   3),
            "pose_energy_score":     round(energy_s, 3),
            "temporal_confirmation": frames,
            "lstm_probability":      round(lstm_s,   3),
        },
        "signal_breakdown": {
            "rule_engine": round((wrist_s + body_s + energy_s) / 3, 3),
            "temporal":    round(min(frames / 4.0, 1.0), 3),
            "lstm":        round(lstm_s, 3),
            "autoencoder": round(_sigmoid_scale(ae_error or 0.0, centre=0.08, scale=15.0), 3),
        },
        "temporal_confirmation": frames,
    }


def _explain_inactivity(ev: dict, anomaly_type: str, lstm_result) -> dict:
    seconds = ev.get("inactivity_seconds", 0.0)
    energy  = ev.get("pose_energy",        0.0)
    lstm_s  = lstm_result["prob"] if lstm_result and lstm_result["class"] == "prolonged_inactivity" else 0.0

    sev_label = "prolonged" if anomaly_type == "prolonged_inactivity" else "early"
    parts = [
        f"no significant movement for {seconds:.0f} seconds",
        f"pose energy at {energy:.5f} (below motion threshold)",
    ]
    if lstm_s > 0.5: parts.append(f"LSTM confirmed inactivity (p={lstm_s:.2f})")

    reason = f"Inactivity alert ({sev_label}): " + "; ".join(parts)

    return {
        "reason": reason,
        "contributing_factors": {
            "inactivity_duration_sec": round(seconds, 1),
            "motion_energy":           round(float(energy), 5),
            "stillness_score":         round(1.0 - min(energy * 50, 1.0), 3),
            "temporal_confirmation":   int(seconds * 5),  # approx frames
            "lstm_probability":        round(lstm_s, 3),
        },
        "signal_breakdown": {
            "rule_engine": round(min(seconds / 60.0, 1.0), 3),
            "temporal":    round(min(seconds / 120.0, 1.0), 3),
            "lstm":        round(lstm_s, 3),
            "autoencoder": 0.0,
        },
        "temporal_confirmation": int(seconds * 5),
    }


def _explain_unusual(ae_error) -> dict:
    ae_s = _sigmoid_scale(ae_error or 0.0, centre=0.1, scale=12.0)
    reason = (
        f"Unusual movement pattern: autoencoder reconstruction error {ae_error:.4f} "
        f"exceeds normal behaviour threshold. Pattern does not match learned normal "
        f"activity sequences."
    )
    return {
        "reason": reason,
        "contributing_factors": {
            "ae_reconstruction_error": round(ae_error or 0.0, 5),
            "ae_anomaly_score":        round(ae_s, 3),
        },
        "signal_breakdown": {
            "rule_engine": 0.0,
            "temporal":    0.0,
            "lstm":        0.0,
            "autoencoder": round(ae_s, 3),
        },
        "temporal_confirmation": 0,
    }


def _explain_normal(ev: dict) -> dict:
    energy = ev.get("pose_energy", 0.0)
    return {
        "reason": (
            f"Normal activity: all rule thresholds clear, pose energy {energy:.5f} "
            f"within expected range, no sustained fall/aggression/inactivity pattern."
        ),
        "contributing_factors": {
            "pose_energy": round(float(energy), 5),
        },
        "signal_breakdown": {
            "rule_engine": 0.0,
            "temporal":    0.0,
            "lstm":        0.0,
            "autoencoder": 0.0,
        },
        "temporal_confirmation": 0,
    }


# ── Utility ───────────────────────────────────────────────────────────────────

def _sigmoid_scale(x: float, centre: float, scale: float) -> float:
    """Map value x to 0-1 with sigmoid centred at `centre`, steepness `scale`."""
    try:
        return 1.0 / (1.0 + math.exp(-scale * (x - centre)))
    except OverflowError:
        return 1.0 if x > centre else 0.0
