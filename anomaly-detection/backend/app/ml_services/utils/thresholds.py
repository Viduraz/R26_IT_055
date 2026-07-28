"""
anomaly-detection/backend/app/ml_services/utils/thresholds.py
All rule-engine and ML decision thresholds in one place for easy tuning.
"""

# ── ML Model Thresholds ───────────────────────────────────────────────────────
LSTM_THRESHOLD: float = 0.90   # LSTM anomaly probability → fire event (Must be 90%+)
AE_THRESHOLD:   float = 0.05   # Autoencoder reconstruction error → anomaly

# ── Fall Detection Rules ──────────────────────────────────────────────────────
FALL_TORSO_ANGLE_DEG:   float = 60.0   # torso > this degrees tilt → suspect fall (increased)
FALL_HEAD_DROP_RATIO:   float = 0.35   # head y drops > 35% of frame height quickly
FALL_PERSIST_FRAMES:    int   = 8      # must persist for 8 frames (~1.5s) before confirming
FALL_BODY_LOW_RATIO:    float = 0.75   # body centre y > 75% of frame = near floor

# ── Inactivity Detection Rules ────────────────────────────────────────────────
INACTIVITY_ENERGY_THRESHOLD: float = 0.012  # total pose energy below this = still (increased to ignore small fidgets)
INACTIVITY_WARNING_SEC:      int   = 3      # warn after 3s
INACTIVITY_ALERT_SEC:        int   = 6      # alert after 6s
INACTIVITY_CRITICAL_SEC:     int   = 10     # critical after 10s

# ── Aggression Detection Rules ────────────────────────────────────────────────
AGGRESSION_WRIST_VELOCITY:   float = 0.08   # wrist frame-to-frame delta (increased to ignore normal arm swings)
AGGRESSION_BODY_VELOCITY:    float = 0.04   # body centre velocity > this
AGGRESSION_ENERGY_HIGH:      float = 0.06   # total pose energy > this = high motion
AGGRESSION_PERSIST_FRAMES:   int   = 5      # must occur for 5 frames (~1 sec) to ignore quick jerks

# ── Sequence Buffer ───────────────────────────────────────────────────────────
SEQUENCE_WINDOW:  int = 30    # frames per analysis window
SEQUENCE_STRIDE:  int = 5     # slide window by this many frames
