"""
anomaly-detection/backend/app/ml_services/inference/detect_anomaly.py
Fuse LSTM and Autoencoder results to determine anomaly.
"""
from app.ml_services.utils.thresholds import LSTM_THRESHOLD, AE_THRESHOLD


def detect_anomaly(lstm_prob: float, ae_error: float) -> dict:
    """
    Fuse LSTM classification probability and AE reconstruction error.

    Returns:
        {"anomaly_detected": bool, "confidence": float, "event_type": str}
    """
    if lstm_prob >= LSTM_THRESHOLD and ae_error >= AE_THRESHOLD:
        return {"anomaly_detected": True, "confidence": lstm_prob, "event_type": "fall_or_anomaly"}
    elif lstm_prob >= LSTM_THRESHOLD:
        return {"anomaly_detected": True, "confidence": lstm_prob, "event_type": "lstm_alert"}
    elif ae_error >= AE_THRESHOLD:
        return {"anomaly_detected": True, "confidence": 1.0 - ae_error, "event_type": "ae_alert"}
    return {"anomaly_detected": False, "confidence": 0.0, "event_type": "normal"}
