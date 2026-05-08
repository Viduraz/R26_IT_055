"""
anomaly-detection/backend/app/services/anomaly_service.py

Full pipeline orchestration:
    Frame → Pose Extraction → Feature Engineering → Sequence Buffer
    → Rule Engine → LSTM (if weights) → Autoencoder (if weights)
    → Decision Fusion → Alert Logging → Return Event
"""
import os
from datetime import datetime, timezone
from shared.backend.config.database import get_db

from app.schemas.anomaly_schema import AnomalyProcessRequest
from app.ml_services.inference.extract_pose   import extract_pose
from app.ml_services.inference.feature_engineer import engineer_features
from app.ml_services.inference.sequence_buffer  import push, get_sequence, get_prev_raw, is_full
from app.ml_services.inference.rule_engine      import evaluate as rule_evaluate
from app.ml_services.inference.detect_anomaly   import decide
from app.ml_services.models.lstm_model          import predict as lstm_predict
from app.ml_services.models.autoencoder_model   import reconstruction_error
from app.services.alert_service                 import log_alert


class AnomalyService:

    async def process_frame(self, payload: AnomalyProcessRequest) -> dict:
        person_id    = payload.person_id    or "default"
        caregiver_id = payload.caregiver_id or None
        session_id   = payload.session_id   or None
        ts           = datetime.now(timezone.utc).isoformat()

        # ── Step 1: Pose Extraction ───────────────────────────────────────────
        pose_data = extract_pose(payload.live_frame)

        if not pose_data["valid"]:
            return {
                "anomaly_type": "no_person",
                "confidence":   0.0,
                "severity":     "none",
                "source":       "pose_extractor",
                "person_id":    person_id,
                "timestamp":    ts,
                "pose_valid":   False,
                "lstm_used":    False,
                "ae_used":      False,
                "bbox":         None,
                "keypoints":    None,
                "evidence":     {},
            }

        raw_lms = pose_data["raw"]
        bbox    = pose_data["bbox"]
        kpts_out = [[round(lm[0],4), round(lm[1],4), round(lm[3],4)] for lm in raw_lms]

        # ── Step 2: Feature Engineering ───────────────────────────────────────
        prev_raw = get_prev_raw(person_id)
        features = engineer_features(raw_lms, prev_raw)

        # ── Step 3: Push to Sequence Buffer ───────────────────────────────────
        push(person_id, features, raw_lms)

        # ── Step 4: Rule Engine (always runs) ─────────────────────────────────
        rule_result = rule_evaluate(features, person_id)

        # ── Step 5: LSTM (only if buffer full and weights available) ──────────
        sequence   = get_sequence(person_id) if is_full(person_id) else []
        lstm_result = lstm_predict(sequence) if sequence else None

        # ── Step 6: Autoencoder Reconstruction Error ───────────────────────────
        ae_error = reconstruction_error(sequence) if sequence else None

        # ── Step 7: Decision Fusion ───────────────────────────────────────────
        event = decide(rule_result, lstm_result, ae_error)
        event["person_id"]    = person_id
        event["caregiver_id"] = caregiver_id
        event["session_id"]   = session_id
        event["timestamp"]    = ts
        event["pose_valid"]   = True
        event["bbox"]         = bbox
        event["keypoints"]    = kpts_out

        # ── Step 8: Log to MongoDB if anomaly ─────────────────────────────────
        if event["anomaly_type"] not in ("normal_activity", "no_person"):
            log_alert(event, person_id, caregiver_id, session_id, event.get("evidence", {}))

        return event

    async def fetch_logs(self) -> list:
        try:
            db = get_db()
            logs = list(db["anomaly_logs"].find({}, {"_id": 0}).sort("timestamp", -1).limit(100))
            return logs
        except Exception as e:
            print(f"[ERROR] fetch_logs: {repr(e)}")
            return []

    async def get_status(self) -> dict:
        """Return current model weights availability and service status."""
        from app.ml_services.models.lstm_model        import LSTM_WEIGHTS_PATH
        from app.ml_services.models.autoencoder_model  import AE_WEIGHTS_PATH

        return {
            "mediapipe_pose":    "loaded",
            "lstm_weights":      "loaded" if os.path.exists(LSTM_WEIGHTS_PATH) else "not_found",
            "autoencoder_weights": "loaded" if os.path.exists(AE_WEIGHTS_PATH)  else "not_found",
            "lstm_path":         LSTM_WEIGHTS_PATH,
            "ae_path":           AE_WEIGHTS_PATH,
            "active_rule_engine": True,
            "feature_dimensions": 40,
            "sequence_window":    30,
        }
