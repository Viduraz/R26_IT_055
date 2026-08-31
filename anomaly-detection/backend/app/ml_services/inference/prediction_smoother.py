"""
anomaly-detection/backend/app/ml_services/inference/prediction_smoother.py

Temporal prediction smoother — prevents single-frame false positives.

Strategy:
  - Maintain a rolling window of the last N predictions per person.
  - Apply majority voting: only confirm an anomaly if it appears in > 50% of
    recent frames.
  - Apply confidence averaging over the matching frames.
  - Critical events (fall) require fewer confirming frames than lower-severity
    events (inactivity_warning).

This makes the system behave like a production monitor rather than a
frame-by-frame classifier.
"""
from collections import deque

# ── Tunable thresholds ────────────────────────────────────────────────────────
WINDOW_SIZE    = 8   # rolling window length (frames)
VOTE_THRESHOLD = 0.50  # fraction of window that must agree to confirm

# Per-class minimum agree frames (stricter for lower-severity events)
MIN_VOTES = {
    "fall_detected":        3,   # critical — fast response
    "aggression_detected":  3,   # high
    "prolonged_inactivity": 4,   # high
    "inactivity_warning":   5,   # medium — needs more frames
    "unusual_movement":     4,
    "normal_activity":      1,   # always pass through immediately
    "no_person":            1,
}


class PredictionSmoother:
    """
    Per-person smoothing buffer.
    Call smoother.update(anomaly_type, confidence) every frame.
    Returns the stabilised (type, confidence) tuple.
    """

    def __init__(self):
        self._history: deque[tuple[str, float]] = deque(maxlen=WINDOW_SIZE)

    def update(self, raw_type: str, raw_conf: float) -> tuple[str, float]:
        """
        Push new prediction into the rolling window and return the
        smoothed (anomaly_type, confidence) after majority voting.
        """
        self._history.append((raw_type, raw_conf))

        if len(self._history) < 2:
            # Not enough history yet — pass through raw
            return raw_type, raw_conf

        # Count votes per class in the window
        counts: dict[str, list[float]] = {}
        for atype, conf in self._history:
            counts.setdefault(atype, []).append(conf)

        # Find the winning class (most votes)
        winner = max(counts, key=lambda k: len(counts[k]))
        winner_votes  = len(counts[winner])
        winner_confs  = counts[winner]
        min_votes_req = MIN_VOTES.get(winner, 3)

        # If winner doesn't have enough votes, fall back to normal
        if winner_votes < min_votes_req:
            # Find best anomaly that does have enough votes
            for atype in ("fall_detected", "aggression_detected",
                          "prolonged_inactivity", "inactivity_warning",
                          "unusual_movement"):
                if len(counts.get(atype, [])) >= MIN_VOTES.get(atype, 3):
                    winner       = atype
                    winner_confs = counts[atype]
                    break
            else:
                winner       = "normal_activity"
                winner_confs = counts.get("normal_activity", [raw_conf])

        # Smooth confidence: weighted average (recent frames count more)
        smoothed_conf = _weighted_average(winner_confs)

        return winner, round(smoothed_conf, 3)

    def flush(self):
        """Clear buffer (call on session end)."""
        self._history.clear()


def _weighted_average(values: list[float]) -> float:
    """More recent values carry higher weight (linear ramp)."""
    if not values:
        return 0.0
    n       = len(values)
    weights = [i + 1 for i in range(n)]   # 1, 2, 3, …, n
    total_w = sum(weights)
    return sum(v * w for v, w in zip(values, weights)) / total_w
