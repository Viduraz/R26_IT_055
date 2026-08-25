"""
anomaly-detection/backend/app/ml_services/inference/feature_engineer.py

Converts raw MediaPipe landmarks into a rich feature vector per frame.
These features are more stable than raw coordinates for ML and rules.

Phase 3 additions (same 40-dim output, enriched signals):
    - Body Tilt Angle (3D using z-depth from MediaPipe)
    - Center of Mass (CoM) displacement & stability score
    - Motion Energy Score (total displacement over frame)

    [0–7]   Joint angles (shoulder, elbow, knee, hip) normalised /180
    [8]     Torso angle from vertical normalised /90
    [9–10]  Hip slope, shoulder slope
    [11–12] Body centre X, Y
    [13]    Head height above hips
    [14]    Aspect ratio /3
    [15–17] Visibility scores (L wrist, R wrist, avg)
    [18]    Body velocity
    [19–20] Wrist L / R velocity
    [21]    Head drop speed
    [22]    Pose energy (total displacement)
    [23–38] Raw key joint positions (16 floats: nose, shoulders, hips, wrists, hip_cx/cy)
    [39]    CoM stability score
    [40–47] 8 NEW Kinematic/Spatial Features (BB Area, Wrist Dist, Ankle Dist, Head Floor, Torso H, Body CX, Body CY norm, Avg Vel)

PHASE 3 enriched signals embedded into existing indices:
    [8]     Now uses 3D torso tilt (incorporates z-depth for better fall detection)
    [22]    Now is Motion Energy Score (same as pose_energy, renamed semantically)
    [39]    Now is CoM stability score (replaces avg wrist velocity in explanations)
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


def _dist3d(a, b) -> float:
    """3D distance using x, y, z (index 0,1,2)."""
    return math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2)


def engineer_features(raw: list, prev_raw: list = None) -> np.ndarray:
    """
    Args:
        raw:      Current frame landmarks — list of 33 × [x, y, z, vis]
        prev_raw: Previous frame landmarks (optional, enables velocity features)
    Returns:
        np.ndarray of shape (48,)
    """
    if not raw or len(raw) < 29:
        return np.zeros(48, dtype=np.float32)

    def lm(idx):
        return raw[idx][:2]   # [x, y]

    def lm3(idx):
        return raw[idx][:3]   # [x, y, z]

    # ── 1. Joint Angles ───────────────────────────────────────────────────────
    left_elbow_angle     = _angle(lm(_L_SHOULDER), lm(_L_ELBOW),    lm(_L_WRIST))
    right_elbow_angle    = _angle(lm(_R_SHOULDER), lm(_R_ELBOW),    lm(_R_WRIST))
    left_shoulder_angle  = _angle(lm(_L_HIP),      lm(_L_SHOULDER), lm(_L_ELBOW))
    right_shoulder_angle = _angle(lm(_R_HIP),      lm(_R_SHOULDER), lm(_R_ELBOW))
    left_knee_angle      = _angle(lm(_L_HIP),      lm(_L_KNEE),     lm(_L_ANKLE))
    right_knee_angle     = _angle(lm(_R_HIP),      lm(_R_KNEE),     lm(_R_ANKLE))
    left_hip_angle       = _angle(lm(_L_SHOULDER), lm(_L_HIP),      lm(_L_KNEE))
    right_hip_angle      = _angle(lm(_R_SHOULDER), lm(_R_HIP),      lm(_R_KNEE))

    # ── 2. Torso geometry (2D + 3D tilt for Phase 3) ─────────────────────────
    hip_cx  = (lm(_L_HIP)[0]      + lm(_R_HIP)[0])      / 2
    hip_cy  = (lm(_L_HIP)[1]      + lm(_R_HIP)[1])      / 2
    sho_cx  = (lm(_L_SHOULDER)[0] + lm(_R_SHOULDER)[0]) / 2
    sho_cy  = (lm(_L_SHOULDER)[1] + lm(_R_SHOULDER)[1]) / 2

    # 2D torso angle from vertical
    dx_torso    = sho_cx - hip_cx
    dy_torso    = sho_cy - hip_cy
    torso_angle_2d = math.degrees(math.atan2(abs(dx_torso), max(abs(dy_torso), 1e-6)))

    # 3D body tilt using z-depth (Phase 3 enhancement)
    # MediaPipe z is relative depth — large z-diff between hip and shoulder = leaning
    hip_z_avg = (raw[_L_HIP][2] + raw[_R_HIP][2]) / 2 if len(raw[0]) > 2 else 0.0
    sho_z_avg = (raw[_L_SHOULDER][2] + raw[_R_SHOULDER][2]) / 2 if len(raw[0]) > 2 else 0.0
    z_tilt_bonus = abs(sho_z_avg - hip_z_avg) * 30.0   # amplify z-depth signal
    body_tilt_angle = min(torso_angle_2d + z_tilt_bonus, 90.0)

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
    vis_avg = sum(raw[i][3] for i in range(33)) / 33

    # ── 8. Velocity + energy features ────────────────────────────────────────
    body_velocity   = 0.0
    wrist_l_vel     = 0.0
    wrist_r_vel     = 0.0
    head_drop_speed = 0.0
    pose_energy     = 0.0
    com_stability   = 0.0   # Phase 3: Center of Mass displacement stability

    if prev_raw and len(prev_raw) == 33:
        def plm(idx):
            return prev_raw[idx][:2]

        prev_hip_cx  = (plm(_L_HIP)[0]      + plm(_R_HIP)[0])      / 2
        prev_hip_cy  = (plm(_L_HIP)[1]      + plm(_R_HIP)[1])      / 2
        prev_sho_cx  = (plm(_L_SHOULDER)[0] + plm(_R_SHOULDER)[0]) / 2
        prev_sho_cy  = (plm(_L_SHOULDER)[1] + plm(_R_SHOULDER)[1]) / 2
        prev_body_cx = (prev_hip_cx + prev_sho_cx) / 2
        prev_body_cy = (prev_hip_cy + prev_sho_cy) / 2

        body_velocity   = _dist((body_cx, body_cy), (prev_body_cx, prev_body_cy))
        wrist_l_vel     = _dist(lm(_L_WRIST), plm(_L_WRIST))
        wrist_r_vel     = _dist(lm(_R_WRIST), plm(_R_WRIST))
        head_drop_speed = raw[_NOSE][1] - prev_raw[_NOSE][1]  # +ve = dropping

        # Motion Energy Score (Phase 3) — total per-landmark displacement
        pose_energy = sum(_dist(raw[i][:2], prev_raw[i][:2]) for i in range(33))

        # Center of Mass stability score (Phase 3)
        # High = stable/inactive, Low = moving.  Inversely scaled for ML.
        com_displacement = body_velocity
        com_stability    = max(0.0, 1.0 - com_displacement * 20.0)  # 0=moving, 1=still

    # ── 9. New Physics / Spatial Features (Phase 4 98% Target) ───────────────
    bb_area       = body_w * body_h
    wrist_dist    = _dist(lm(_L_WRIST), lm(_R_WRIST))
    ankle_dist    = _dist(lm(_L_ANKLE), lm(_R_ANKLE))
    head_floor    = 1.0 - raw[_NOSE][1]  # roughly distance from bottom of frame
    torso_h       = _dist((sho_cx, sho_cy), (hip_cx, hip_cy))
    norm_body_cx  = body_cx * 2.0 - 1.0
    norm_body_cy  = body_cy * 2.0 - 1.0
    avg_wrist_vel = (wrist_l_vel + wrist_r_vel) / 2.0

    # ── Assemble feature vector (40 dims) ─────────────────────────────────────
    features = np.array([
        # [0–7] Joint angles
        left_elbow_angle     / 180.0,
        right_elbow_angle    / 180.0,
        left_shoulder_angle  / 180.0,
        right_shoulder_angle / 180.0,
        left_knee_angle      / 180.0,
        right_knee_angle     / 180.0,
        left_hip_angle       / 180.0,
        right_hip_angle      / 180.0,
        # [8] Body tilt (Phase 3: 3D-enhanced torso angle)
        body_tilt_angle / 90.0,
        # [9–10] Slopes
        hip_slope,
        sho_slope,
        # [11–12] Body centre position
        body_cx,
        body_cy,
        # [13] Head height above hips
        head_height,
        # [14] Aspect ratio
        aspect_ratio / 3.0,
        # [15–17] Visibility
        vis_left_wrist,
        vis_right_wrist,
        vis_avg,
        # [18–22] Velocity + Motion Energy Score
        body_velocity,
        wrist_l_vel,
        wrist_r_vel,
        head_drop_speed,
        pose_energy,          # [22] Motion Energy Score
        # [23–38] Raw positions (16 floats)
        lm(_NOSE)[0],          lm(_NOSE)[1],
        lm(_L_SHOULDER)[0],    lm(_L_SHOULDER)[1],
        lm(_R_SHOULDER)[0],    lm(_R_SHOULDER)[1],
        lm(_L_HIP)[0],         lm(_L_HIP)[1],
        lm(_R_HIP)[0],         lm(_R_HIP)[1],
        lm(_L_WRIST)[0],       lm(_L_WRIST)[1],
        lm(_R_WRIST)[0],       lm(_R_WRIST)[1],
        hip_cx,                hip_cy,
        # [39] CoM stability score (Phase 3)
        com_stability,
        # [40-47] Phase 4 Physics Features
        bb_area,
        wrist_dist,
        ankle_dist,
        head_floor,
        torso_h,
        norm_body_cx,
        norm_body_cy,
        avg_wrist_vel,
    ], dtype=np.float32)

    return np.clip(features, -5.0, 5.0)
