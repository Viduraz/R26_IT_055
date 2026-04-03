"""
anomaly-detection/backend/app/ml_services/inference/feature_engineer.py

Converts raw MediaPipe landmarks into a rich feature vector per frame.
These features are more stable than raw coordinates for ML and rules.

Output feature set (≈ 40 values per frame):
    - joint angles (shoulder, elbow, knee, hip)
    - torso angle from vertical
    - hip-shoulder slope
    - head drop speed (requires prev frame)
    - body centre position + velocity
    - wrist velocity
    - body aspect ratio (h/w bounding box)
    - total pose energy (sum of all joint displacements)
"""
import math
import numpy as np

# MediaPipe landmark indices
_NOSE          = 0
_L_SHOULDER    = 11; _R_SHOULDER = 12
_L_ELBOW       = 13; _R_ELBOW    = 14
_L_WRIST       = 15; _R_WRIST    = 16
_L_HIP         = 23; _R_HIP      = 24
_L_KNEE        = 25; _R_KNEE     = 26
_L_ANKLE       = 27; _R_ANKLE    = 28


def _angle(a, b, c) -> float:
    """Angle at vertex b formed by points a→b→c (degrees)."""
    try:
        ba = (a[0] - b[0], a[1] - b[1])
        bc = (c[0] - b[0], c[1] - b[1])
        dot = ba[0]*bc[0] + ba[1]*bc[1]
        mag_ba = math.sqrt(ba[0]**2 + ba[1]**2) + 1e-9
        mag_bc = math.sqrt(bc[0]**2 + bc[1]**2) + 1e-9
        cos_ang = max(-1.0, min(1.0, dot / (mag_ba * mag_bc)))
        return math.degrees(math.acos(cos_ang))
    except Exception:
        return 0.0


def _dist(a, b) -> float:
    return math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2)


def engineer_features(raw: list, prev_raw: list = None) -> np.ndarray:
    """
    Args:
        raw:      Current frame landmarks — list of 33 × [x, y, z, vis]
        prev_raw: Previous frame landmarks (optional, enables velocity features)
    Returns:
        np.ndarray of shape (N_FEATURES,)  ≈ 40 floats
    """
    if not raw or len(raw) < 29:
        return np.zeros(40, dtype=np.float32)

    def lm(idx):
        return raw[idx][:2]   # [x, y]

    # ── 1. Joint Angles ───────────────────────────────────────────────────────
    left_elbow_angle  = _angle(lm(_L_SHOULDER), lm(_L_ELBOW), lm(_L_WRIST))
    right_elbow_angle = _angle(lm(_R_SHOULDER), lm(_R_ELBOW), lm(_R_WRIST))
    left_shoulder_angle  = _angle(lm(_L_HIP),   lm(_L_SHOULDER), lm(_L_ELBOW))
    right_shoulder_angle = _angle(lm(_R_HIP),   lm(_R_SHOULDER), lm(_R_ELBOW))
    left_knee_angle   = _angle(lm(_L_HIP),   lm(_L_KNEE),   lm(_L_ANKLE))
    right_knee_angle  = _angle(lm(_R_HIP),   lm(_R_KNEE),   lm(_R_ANKLE))
    left_hip_angle    = _angle(lm(_L_SHOULDER), lm(_L_HIP),  lm(_L_KNEE))
    right_hip_angle   = _angle(lm(_R_SHOULDER), lm(_R_HIP),  lm(_R_KNEE))

    # ── 2. Torso angle from vertical ─────────────────────────────────────────
    hip_cx  = (lm(_L_HIP)[0]  + lm(_R_HIP)[0])  / 2
    hip_cy  = (lm(_L_HIP)[1]  + lm(_R_HIP)[1])  / 2
    sho_cx  = (lm(_L_SHOULDER)[0] + lm(_R_SHOULDER)[0]) / 2
    sho_cy  = (lm(_L_SHOULDER)[1] + lm(_R_SHOULDER)[1]) / 2
    dx_torso = sho_cx - hip_cx
    dy_torso = sho_cy - hip_cy
    torso_angle = math.degrees(math.atan2(abs(dx_torso), max(abs(dy_torso), 1e-6)))

    # ── 3. Hip-shoulder slope (lateral lean) ─────────────────────────────────
    hip_slope = (lm(_R_HIP)[1] - lm(_L_HIP)[1]) / max(abs(lm(_R_HIP)[0] - lm(_L_HIP)[0]), 1e-6)
    sho_slope = (lm(_R_SHOULDER)[1] - lm(_L_SHOULDER)[1]) / max(abs(lm(_R_SHOULDER)[0] - lm(_L_SHOULDER)[0]), 1e-6)

    # ── 4. Body centre position ───────────────────────────────────────────────
    body_cx = (hip_cx + sho_cx) / 2
    body_cy = (hip_cy + sho_cy) / 2

    # ── 5. Head (nose) position relative to hips ─────────────────────────────
    nose_y      = raw[_NOSE][1]
    head_height = hip_cy - nose_y   # positive = nose above hips (standing)

    # ── 6. Body aspect ratio ─────────────────────────────────────────────────
    all_x = [raw[i][0] for i in range(33)]
    all_y = [raw[i][1] for i in range(33)]
    body_w = max(max(all_x) - min(all_x), 1e-6)
    body_h = max(max(all_y) - min(all_y), 1e-6)
    aspect_ratio = body_h / body_w   # tall&thin=standing, short&wide=lying

    # ── 7. Visibility scores for key joints ──────────────────────────────────
    vis_left_wrist  = raw[_L_WRIST][3]
    vis_right_wrist = raw[_R_WRIST][3]
    vis_avg = sum(lm[3] for lm in raw) / 33

    # ── 8. Velocity features (require previous frame) ────────────────────────
    body_velocity  = 0.0
    wrist_l_vel    = 0.0
    wrist_r_vel    = 0.0
    head_drop_speed = 0.0
    pose_energy    = 0.0

    if prev_raw and len(prev_raw) == 33:
        def plm(idx):
            return prev_raw[idx][:2]

        body_velocity   = _dist((body_cx, body_cy), (
            ((plm(_L_HIP)[0]+plm(_R_HIP)[0])/2 + (plm(_L_SHOULDER)[0]+plm(_R_SHOULDER)[0])/2) / 2,
            ((plm(_L_HIP)[1]+plm(_R_HIP)[1])/2 + (plm(_L_SHOULDER)[1]+plm(_R_SHOULDER)[1])/2) / 2,
        ))
        wrist_l_vel     = _dist(lm(_L_WRIST), plm(_L_WRIST))
        wrist_r_vel     = _dist(lm(_R_WRIST), plm(_R_WRIST))
        head_drop_speed = raw[_NOSE][1] - prev_raw[_NOSE][1]  # +ve = dropping
        pose_energy     = sum(_dist(raw[i][:2], prev_raw[i][:2]) for i in range(33))

    # ── Assemble feature vector ───────────────────────────────────────────────
    features = np.array([
        # Joint angles (8)
        left_elbow_angle / 180.0,
        right_elbow_angle / 180.0,
        left_shoulder_angle / 180.0,
        right_shoulder_angle / 180.0,
        left_knee_angle / 180.0,
        right_knee_angle / 180.0,
        left_hip_angle / 180.0,
        right_hip_angle / 180.0,
        # Posture geometry (7)
        torso_angle / 90.0,
        hip_slope,
        sho_slope,
        body_cx,
        body_cy,
        head_height,
        aspect_ratio / 3.0,
        # Visibility (3)
        vis_left_wrist,
        vis_right_wrist,
        vis_avg,
        # Velocity + energy (6)
        body_velocity,
        wrist_l_vel,
        wrist_r_vel,
        head_drop_speed,
        pose_energy,
        # Raw positions for reference (16: key joints x,y)
        lm(_NOSE)[0],       lm(_NOSE)[1],
        lm(_L_SHOULDER)[0], lm(_L_SHOULDER)[1],
        lm(_R_SHOULDER)[0], lm(_R_SHOULDER)[1],
        lm(_L_HIP)[0],      lm(_L_HIP)[1],
        lm(_R_HIP)[0],      lm(_R_HIP)[1],
        lm(_L_WRIST)[0],    lm(_L_WRIST)[1],
        lm(_R_WRIST)[0],    lm(_R_WRIST)[1],
        hip_cx,             hip_cy,
    ], dtype=np.float32)

    return np.clip(features, -5.0, 5.0)   # clip to prevent outlier explosion
