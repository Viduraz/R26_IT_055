"""
anomaly-detection/backend/app/ml_services/inference/sequence_buffer.py

Per-person rolling window buffer.
Stores the last N feature vectors and raw pose frames in memory.
Used to feed temporal context to LSTM and rule engine.
"""
from collections import deque
from threading import Lock
from app.ml_services.utils.thresholds import SEQUENCE_WINDOW

# _buffers: { person_id → { "features": deque, "raw": deque, "inactivity_frames": int } }
_buffers: dict = {}
_lock = Lock()


def _get_or_create(person_id: str) -> dict:
    if person_id not in _buffers:
        _buffers[person_id] = {
            "features":          deque(maxlen=SEQUENCE_WINDOW),
            "raw":               deque(maxlen=SEQUENCE_WINDOW),
            "inactivity_frames": 0,
            "aggression_frames": 0,
            "fall_frames":       0,
        }
    return _buffers[person_id]


def push(person_id: str, features, raw_landmarks):
    """Push one frame's feature vector and raw landmarks into the buffer."""
    with _lock:
        buf = _get_or_create(person_id)
        buf["features"].append(features)
        buf["raw"].append(raw_landmarks)


def get_sequence(person_id: str) -> list:
    """Return the current feature sequence as a list (oldest→newest)."""
    with _lock:
        buf = _buffers.get(person_id)
        if not buf:
            return []
        return list(buf["features"])


def get_prev_raw(person_id: str):
    """Return the second-to-last raw frame (for velocity calculation)."""
    with _lock:
        buf = _buffers.get(person_id)
        if not buf or len(buf["raw"]) < 2:
            return None
        return list(buf["raw"])[-2]


def is_full(person_id: str) -> bool:
    with _lock:
        buf = _buffers.get(person_id)
        return bool(buf and len(buf["features"]) >= SEQUENCE_WINDOW)


def increment_counter(person_id: str, key: str):
    """Increment a named frame counter (fall_frames, inactivity_frames, etc.)."""
    with _lock:
        buf = _get_or_create(person_id)
        buf[key] = buf.get(key, 0) + 1
        return buf[key]


def reset_counter(person_id: str, key: str):
    with _lock:
        buf = _buffers.get(person_id)
        if buf:
            buf[key] = 0


def get_counter(person_id: str, key: str) -> int:
    with _lock:
        buf = _buffers.get(person_id)
        return buf.get(key, 0) if buf else 0


def flush(person_id: str):
    """Reset all buffer state for a person (e.g. when camera stops)."""
    with _lock:
        _buffers.pop(person_id, None)
