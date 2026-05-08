"""
anomaly-detection/backend/app/ml_services/utils/thresholds.py
All rule-engine and ML decision thresholds in one place for easy tuning.
"""

# ── ML Model Thresholds ───────────────────────────────────────────────────────
LSTM_THRESHOLD: float = 0.70   # LSTM anomaly probability → fire event
AE_THRESHOLD:   float = 0.05   # Autoencoder reconstruction error → anomaly

# ── Fall Detection Rules ──────────────────────────────────────────────────────
FALL_TORSO_ANGLE_DEG:   float = 55.0   # torso > this degrees tilt → suspect fall
FALL_HEAD_DROP_RATIO:   float = 0.25   # head y drops > 25% of frame height quickly
FALL_PERSIST_FRAMES:    int   = 6      # must persist for N frames before confirming
FALL_BODY_LOW_RATIO:    float = 0.70   # body centre y > 70% of frame = near floor

# ── Inactivity Detection Rules ────────────────────────────────────────────────
INACTIVITY_ENERGY_THRESHOLD: float = 0.008  # total pose energy below this = still
INACTIVITY_WARNING_SEC:      int   = 15     # warn after 15s
INACTIVITY_ALERT_SEC:        int   = 30     # alert after 30s
INACTIVITY_CRITICAL_SEC:     int   = 60     # critical after 60s

# ── Aggression Detection Rules ────────────────────────────────────────────────
AGGRESSION_WRIST_VELOCITY:   float = 0.08   # wrist frame-to-frame delta > this
AGGRESSION_BODY_VELOCITY:    float = 0.05   # body centre velocity > this
AGGRESSION_ENERGY_HIGH:      float = 0.06   # total pose energy > this = high motion
AGGRESSION_PERSIST_FRAMES:   int   = 5      # must occur in N frames

# ── Sequence Buffer ───────────────────────────────────────────────────────────
SEQUENCE_WINDOW:  int = 30    # frames per analysis window
SEQUENCE_STRIDE:  int = 5     # slide window by this many frames
