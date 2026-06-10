"""
anomaly-detection/backend/app/services/anomaly_service.py

Full pipeline orchestration with stability hardening (Phase 2):
    Frame → Pose Extraction → Feature Engineering → Sequence Buffer
    → Rule Engine → LSTM (if weights) → Autoencoder (if weights)
    → Decision Fusion → Prediction Smoother → Alert Logging → Return Event

Phase 2 Changes:
    - Full try/catch isolation per pipeline step
    - Graceful skip on corrupted/empty frames (never crashes)
    - Prediction smoother integrated before returning event
    - Auto-recovery logging on any step failure
"""
import os
from datetime import datetime, timezone
from shared.backend.config.database import get_db

from app.schemas.anomaly_schema import AnomalyProcessRequest
from app.ml_services.inference.extract_pose    import extract_pose
from app.ml_services.inference.feature_engineer import engineer_features
from app.ml_services.inference.sequence_buffer  import push, get_sequence, get_prev_raw, is_full
from app.ml_services.inference.rule_engine      import evaluate as rule_evaluate
from app.ml_services.inference.detect_anomaly   import decide
from app.ml_services.inference.prediction_smoother import PredictionSmoother
from app.ml_services.models.lstm_model          import predict as lstm_predict
from app.ml_services.models.autoencoder_model   import reconstruction_error
from app.services.alert_service                 import log_alert

# Per-person smoother registry (created on demand)
_smoothers: dict[str, PredictionSmoother] = {}

def _get_smoother(person_id: str) -> PredictionSmoother:
    if person_id not in _smoothers:
        _smoothers[person_id] = PredictionSmoother()
    return _smoothers[person_id]

def _no_person_response(person_id: str, ts: str, reason: str = "") -> dict:
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
        "evidence":     {"skip_reason": reason} if reason else {},
    }


class AnomalyService:

    async def process_frame(self, payload: AnomalyProcessRequest) -> dict:
        person_id    = payload.person_id    or "default"
        caregiver_id = payload.caregiver_id or None
        session_id   = payload.session_id   or None
        ts           = datetime.now(timezone.utc).isoformat()

        # ── Step 1: Validate & decode frame ──────────────────────────────────
        if not payload.live_frame or len(payload.live_frame) < 100:
            return _no_person_response(person_id, ts, "empty_or_too_short_frame")

        # ── Step 2: Pose Extraction ───────────────────────────────────────────
        try:
            pose_data = extract_pose(payload.live_frame)
        except Exception as e:
            print(f"[WARN] extract_pose failed for {person_id}: {repr(e)} — skipping frame")
            return _no_person_response(person_id, ts, f"pose_extraction_error: {type(e).__name__}")

        if not pose_data["valid"]:
            return _no_person_response(person_id, ts, "no_pose_detected")

        raw_lms  = pose_data["raw"]
        bbox     = pose_data["bbox"]
        kpts_out = [[round(lm[0], 4), round(lm[1], 4), round(lm[3], 4)] for lm in raw_lms]

        # ── Step 3: Feature Engineering ───────────────────────────────────────
        try:
            prev_raw = get_prev_raw(person_id)
            features = engineer_features(raw_lms, prev_raw)
        except Exception as e:
            print(f"[WARN] engineer_features failed for {person_id}: {repr(e)} — skipping frame")
            return _no_person_response(person_id, ts, f"feature_engineering_error: {type(e).__name__}")

        # ── Step 4: Push to Sequence Buffer ───────────────────────────────────
        try:
            push(person_id, features, raw_lms)
        except Exception as e:
            print(f"[WARN] sequence_buffer.push failed for {person_id}: {repr(e)}")

        # ── Step 5: Rule Engine (always runs) ─────────────────────────────────
        try:
            rule_result = rule_evaluate(features, person_id)
        except Exception as e:
            print(f"[WARN] rule_evaluate failed for {person_id}: {repr(e)} — using normal")
            rule_result = {"event": "normal_activity", "confidence": 1.0,
                           "severity": "none", "source": "rule_engine", "evidence": {}}

        # ── Step 6: LSTM (only if buffer full and weights available) ──────────
        lstm_result = None
        try:
            sequence = get_sequence(person_id) if is_full(person_id) else []
            if sequence:
                lstm_result = lstm_predict(sequence)
        except Exception as e:
            print(f"[WARN] lstm_predict failed for {person_id}: {repr(e)} — skipping LSTM")

        # ── Step 7: Autoencoder Reconstruction Error ──────────────────────────
        ae_error = None
        try:
            if sequence:
                ae_error = reconstruction_error(sequence)
        except Exception as e:
            print(f"[WARN] reconstruction_error failed for {person_id}: {repr(e)} — skipping AE")

        # ── Step 8: Decision Fusion ───────────────────────────────────────────
        try:
            event = decide(rule_result, lstm_result, ae_error)
        except Exception as e:
            print(f"[WARN] decide() failed for {person_id}: {repr(e)} — defaulting to normal")
            event = {"anomaly_type": "normal_activity", "confidence": 1.0, "severity": "none",
                     "source": "fallback", "lstm_used": False, "ae_used": False,
                     "ae_error": None, "rule_event": "normal_activity", "evidence": {}}

        # ── Step 9: Temporal Prediction Smoothing ─────────────────────────────
        try:
            smoother = _get_smoother(person_id)
            smoothed_type, smoothed_conf = smoother.update(
                event["anomaly_type"], event["confidence"]
            )
            event["anomaly_type"] = smoothed_type
            event["confidence"]   = smoothed_conf
            event["smoothed"]     = True
        except Exception as e:
            print(f"[WARN] prediction_smoother failed for {person_id}: {repr(e)}")

        # ── Step 10: Attach metadata ──────────────────────────────────────────
        event["person_id"]    = person_id
        event["caregiver_id"] = caregiver_id
        event["session_id"]   = session_id
        event["timestamp"]    = ts
        event["pose_valid"]   = True
        event["bbox"]         = bbox
        event["keypoints"]    = kpts_out

        # ── Step 11: Log to MongoDB + alert dispatcher if anomaly ─────────────
        if event["anomaly_type"] not in ("normal_activity", "no_person"):
            try:
                log_alert(event, person_id, caregiver_id, session_id, event.get("evidence", {}))
            except Exception as e:
                print(f"[WARN] log_alert failed for {person_id}: {repr(e)}")

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
        from app.ml_services.models.lstm_model       import LSTM_WEIGHTS_PATH
        from app.ml_services.models.autoencoder_model import AE_WEIGHTS_PATH
        lstm_ok = os.path.exists(LSTM_WEIGHTS_PATH)
        ae_ok   = os.path.exists(AE_WEIGHTS_PATH)
        return {
            "mediapipe_pose":       "loaded",
            "lstm_weights":         "loaded" if lstm_ok else "not_found",
            "autoencoder_weights":  "loaded" if ae_ok  else "not_found",
            "lstm_path":            LSTM_WEIGHTS_PATH,
            "ae_path":              AE_WEIGHTS_PATH,
            "active_rule_engine":   True,
            "prediction_smoothing": True,
            "feature_dimensions":   40,
            "sequence_window":      30,
            "decision_mode": (
                "Hybrid (Rule+LSTM+AE)" if lstm_ok and ae_ok else
                "Rule + LSTM"           if lstm_ok          else
                "Rule Engine Only"
            ),
        }
