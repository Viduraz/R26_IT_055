"""
services/feature_extraction/gait_features.py
Temporal / gait feature extraction using sliding window over keypoint sequences.

Extracts dynamic temporal motion features:
  - 8 Joint angular velocities
  - 4 Joint angular accelerations
  - 2 Gait cycle cadence frequencies (via FFT)
  - 2 Gait amplitudes
  - 1 Gait symmetry index
  - 2 Lateral body sway metrics
"""
import numpy as np
import structlog
from collections import deque
from typing import Dict, List, Optional
from scipy.fft import fft

log = structlog.get_logger()


class GaitFeatureExtractor:
    """Extracts temporal motion and gait dynamics from sliding window sequences of skeleton keypoints."""

    TRACKED_ANGLES = [
        "left_knee_angle", "right_knee_angle",
        "left_hip_angle", "right_hip_angle",
        "left_elbow_angle", "right_elbow_angle",
        "left_shoulder_angle", "right_shoulder_angle",
    ]

    def __init__(self, window_size: int = 30, fps: float = 30.0):
        self.window_size = window_size
        self.fps = fps
        self.keypoint_buffer: deque = deque(maxlen=window_size)
        self.angle_buffer: deque = deque(maxlen=window_size)
        self._feature_order: Optional[List[str]] = None

    def add_frame(self, keypoints: Dict[str, Dict], angles: Dict[str, float]):
        """Add one frame of keypoints and joint angles to the sliding buffer."""
        self.keypoint_buffer.append(keypoints)
        self.angle_buffer.append(angles)

    def reset(self):
        """Clear the sliding window buffer."""
        self.keypoint_buffer.clear()
        self.angle_buffer.clear()

    def is_ready(self) -> bool:
        """True once the buffer has collected enough frames (T=30)."""
        return len(self.angle_buffer) >= self.window_size

    def buffer_length(self) -> int:
        return len(self.angle_buffer)

    def is_moving(self) -> bool:
        """Detect whether the subject is actively walking or moving (vs standing static)."""
        if len(self.angle_buffer) < 15:
            return False
        knee_diffs = []
        for side in ["left", "right"]:
            ts = np.array([f.get(f"{side}_knee_angle", 90.0) for f in self.angle_buffer])
            knee_diffs.append(float(np.std(ts)))
        # Average angular standard deviation across knees > 4 degrees indicates natural movement
        return float(np.mean(knee_diffs)) > 4.0

    def _angle_timeseries(self, angle_name: str) -> np.ndarray:
        """Get time series for a specific angle across the sliding window."""
        return np.array([frame.get(angle_name, 0.0) for frame in self.angle_buffer], dtype=np.float64)

    def compute_angular_velocities(self) -> Dict[str, float]:
        """Mean and std of angular velocity for 4 key joint pairs (8 features)."""
        dt = 1.0 / max(self.fps, 1.0)
        velocities = {}
        for angle_name in self.TRACKED_ANGLES[:4]:  # knees + hips
            ts = self._angle_timeseries(angle_name)
            if len(ts) > 1:
                diffs = np.abs(np.diff(ts)) / dt
                velocities[f"{angle_name}_vel_mean"] = float(np.mean(diffs))
                velocities[f"{angle_name}_vel_std"] = float(np.std(diffs))
            else:
                velocities[f"{angle_name}_vel_mean"] = 0.0
                velocities[f"{angle_name}_vel_std"] = 0.0
        return velocities

    def compute_gait_cycle(self) -> Dict[str, float]:
        """FFT-based gait cadence frequency and amplitude (5 features)."""
        features = {}
        for side in ["left", "right"]:
            ts = self._angle_timeseries(f"{side}_knee_angle")
            ts_centered = ts - np.mean(ts)
            N = len(ts_centered)
            if N < 8:
                features[f"{side}_gait_freq"] = 0.0
                features[f"{side}_gait_amp"] = 0.0
                continue

            yf = np.abs(fft(ts_centered))[: N // 2]
            freqs = np.linspace(0, self.fps / 2, N // 2)

            # Walking frequency band: 0.5 – 3.5 Hz
            valid = (freqs >= 0.5) & (freqs <= 3.5)
            if np.any(valid) and np.any(yf[valid] > 0):
                dom_idx = np.argmax(yf[valid])
                features[f"{side}_gait_freq"] = float(freqs[valid][dom_idx])
                features[f"{side}_gait_amp"] = float(yf[valid][dom_idx])
            else:
                features[f"{side}_gait_freq"] = 0.0
                features[f"{side}_gait_amp"] = 0.0

        lf = features.get("left_gait_freq", 0.0)
        rf = features.get("right_gait_freq", 0.0)
        features["gait_symmetry"] = lf / (rf + 1e-8) if rf > 0.01 else 1.0
        return features

    def compute_body_sway(self) -> Dict[str, float]:
        """Lateral body sway from hip center movement (2 features)."""
        hip_x = []
        for kps in self.keypoint_buffer:
            lh = kps.get("left_hip", {})
            rh = kps.get("right_hip", {})
            cx = (lh.get("x", 0.5) + rh.get("x", 0.5)) / 2.0
            hip_x.append(cx)
        hip_x = np.array(hip_x)
        return {
            "body_sway_std": float(np.std(hip_x)) if len(hip_x) > 0 else 0.0,
            "body_sway_range": float(np.ptp(hip_x)) if len(hip_x) > 0 else 0.0,
        }

    def extract_all(self) -> Optional[Dict[str, float]]:
        """Extract the complete temporal feature vector (~15 features)."""
        if not self.is_ready():
            return None
        try:
            features = {}
            features.update(self.compute_angular_velocities())
            features.update(self.compute_gait_cycle())
            features.update(self.compute_body_sway())
            return features
        except Exception as e:
            log.warning("gait_feature_extraction_failed", error=str(e))
            return None

    def get_sequence_matrix(self) -> Optional[np.ndarray]:
        """Get (window_size, 8) normalized joint angle matrix for LSTM temporal branch."""
        if len(self.angle_buffer) < self.window_size:
            return None
        matrix = np.zeros((self.window_size, len(self.TRACKED_ANGLES)), dtype=np.float32)
        for i, frame in enumerate(self.angle_buffer):
            for j, angle_name in enumerate(self.TRACKED_ANGLES):
                # Normalized angle in [0, 1]
                matrix[i, j] = float(frame.get(angle_name, 90.0)) / 180.0
        return matrix
