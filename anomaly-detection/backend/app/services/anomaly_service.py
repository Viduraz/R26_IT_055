"""
anomaly-detection/backend/app/services/anomaly_service.py
Orchestrates MediaPipe pose extraction + LSTM/Autoencoder anomaly detection.
"""
from datetime import datetime
from shared.backend.config.database import get_db


def _logs():
    return get_db()["anomaly_logs"]


class AnomalyService:
    async def run_pipeline(self, user_id: str) -> dict:
        """
        TODO pipeline:
        1. Decode frame → numpy (frame_preprocess)
        2. Extract pose keypoints via MediaPipe (extract_pose.py)
        3. Normalize keypoints (normalize_keypoints.py)
        4. Build sliding window sequence (sequence_builder.py)
        5. Run LSTM classifier (run_lstm.py)
        6. Run Autoencoder for reconstruction error (run_autoencoder.py)
        7. Fuse results to decide anomaly (detect_anomaly.py)
        8. Log and optionally trigger alert
        """
        log = {
            "user_id": user_id,
            "anomaly_detected": False,  # TODO: actual result
            "confidence": 0.0,
            "event_type": "stub",
            "timestamp": datetime.utcnow(),
        }
        _logs().insert_one(log)
        return {"message": "Anomaly pipeline stub — implement MediaPipe + LSTM + Autoencoder."}

    async def fetch_logs(self) -> list:
        return list(_logs().find({}, {"_id": 0}).sort("timestamp", -1).limit(50))
