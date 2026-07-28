"""
anomaly-detection/backend/app/ml_services/inference/detect_anomaly.py

Hybrid decision fusion layer.
Combines rule engine + LSTM + Autoencoder results into one final structured event.
Phase 3: Every event now includes an Intelligence Layer explanation.

Priority:
    1. If LSTM says fall/aggression/inactivity with high confidence → trust it
    2. If Rule engine fires → use its result
    3. If AE error is high → flag as ae_anomaly
    4. Otherwise → normal_activity
"""
from app.ml_services.utils.thresholds import LSTM_THRESHOLD, AE_THRESHOLD
from app.ml_services.inference.decision_explainer import explain


def decide(
    rule_result:  dict,
    lstm_result:  dict | None,
    ae_error:     float | None,
) -> dict:
    """
    Args:
        rule_result:  Output of rule_engine.evaluate()
        lstm_result:  Output of lstm_model.predict() or None
        ae_error:     Reconstruction error float or None

    Returns:
        Final structured anomaly event dict including explanation.
    """
    lstm_used = lstm_result is not None
    ae_used   = ae_error is not None

    # ── Case 1: LSTM high confidence on a known anomaly class ────────────────
    if lstm_used and lstm_result["prob"] >= LSTM_THRESHOLD:
        cls = lstm_result["class"]
        if cls != "normal_activity":
            severity = _severity_from_class(cls)
            conf = lstm_result["prob"]
            if rule_result["event"] != "normal_activity" and _class_matches_rule(cls, rule_result["event"]):
                conf = min(conf + 0.05, 0.99)
            anomaly_type = cls
            event = {
                "anomaly_type": anomaly_type,
                "confidence":   round(conf, 3),
                "severity":     severity,
                "source":       "lstm+rule" if rule_result["event"] != "normal_activity" else "lstm",
                "lstm_used":    True,
                "ae_used":      ae_used,
                "ae_error":     ae_error,
                "rule_event":   rule_result["event"],
                "evidence":     rule_result.get("evidence", {}),
            }
            event["explanation"] = explain(anomaly_type, rule_result, lstm_result, ae_error)
            return event

    # ── Case 2: Rule engine fired ─────────────────────────────────────────────
    if rule_result["event"] != "normal_activity":
        # Phase 4: Dynamic Autoencoder Override for Inactivity
        if rule_result["event"] == "prolonged_inactivity" and ae_used:
            if ae_error < AE_THRESHOLD * 1.5: 
                # AE recognizes this static pose as "normal" (e.g. reading a book). Override!
                rule_result["event"] = "normal_activity"
        
        # Re-check in case it was overridden
        if rule_result["event"] != "normal_activity":
            conf = rule_result["confidence"]
        if ae_used and ae_error >= AE_THRESHOLD:
            conf = min(conf + 0.07, 0.99)
        anomaly_type = rule_result["event"]
        event = {
            "anomaly_type": anomaly_type,
            "confidence":   round(conf, 3),
            "severity":     rule_result["severity"],
            "source":       "rule_engine+ae" if (ae_used and ae_error >= AE_THRESHOLD) else "rule_engine",
            "lstm_used":    lstm_used,
            "ae_used":      ae_used,
            "ae_error":     ae_error,
            "rule_event":   rule_result["event"],
            "evidence":     rule_result.get("evidence", {}),
        }
        event["explanation"] = explain(anomaly_type, rule_result, lstm_result, ae_error)
        return event

    # ── Case 3: Autoencoder sees something unusual but rules don't fire ───────
    if ae_used and ae_error >= AE_THRESHOLD * 2:
        anomaly_type = "unusual_movement"
        event = {
            "anomaly_type": anomaly_type,
            "confidence":   round(min(ae_error * 10, 0.85), 3),
            "severity":     "medium",
            "source":       "autoencoder",
            "lstm_used":    lstm_used,
            "ae_used":      True,
            "ae_error":     ae_error,
            "rule_event":   "normal_activity",
            "evidence":     {"ae_reconstruction_error": ae_error},
        }
        event["explanation"] = explain(anomaly_type, rule_result, lstm_result, ae_error)
        return event

    # ── Case 4: All clear ─────────────────────────────────────────────────────
    event = {
        "anomaly_type": "normal_activity",
        "confidence":   1.0,
        "severity":     "none",
        "source":       "rule_engine",
        "lstm_used":    lstm_used,
        "ae_used":      ae_used,
        "ae_error":     ae_error,
        "rule_event":   "normal_activity",
        "evidence":     rule_result.get("evidence", {}),
    }
    event["explanation"] = explain("normal_activity", rule_result, lstm_result, ae_error)
    return event


def _severity_from_class(cls: str) -> str:
    return {
        "fall_detected":        "critical",
        "aggression_detected":  "high",
        "prolonged_inactivity": "high",
    }.get(cls, "medium")


def _class_matches_rule(lstm_cls: str, rule_event: str) -> bool:
    return (
        (lstm_cls == "fall_detected"        and "fall"       in rule_event) or
        (lstm_cls == "aggression_detected"  and "aggression" in rule_event) or
        (lstm_cls == "prolonged_inactivity" and "inactivity" in rule_event)
    )
