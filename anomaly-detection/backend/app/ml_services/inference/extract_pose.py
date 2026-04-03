"""
anomaly-detection/backend/app/ml_services/inference/extract_pose.py

Full pose extraction pipeline:
    1. Decode base64 frame → OpenCV image
    2. Run MediaPipe Pose
    3. Normalize landmarks relative to hip centre + torso length
    4. Reject low-confidence frames
    5. Return structured dict with raw + normalized keypoints and bbox
"""
import base64
import cv2
import numpy as np
from app.ml_services.models.mediapipe_pose import get_pose

# MediaPipe landmark indices (used for normalization reference points)
_LEFT_HIP   = 23
_RIGHT_HIP  = 24
_LEFT_SHOULDER  = 11
_RIGHT_SHOULDER = 12
_NOSE = 0
_MIN_VISIBILITY = 0.3   # reject landmarks below this confidence


def decode_frame(base64_img: str) -> np.ndarray:
    """Decode a base64 JPEG/PNG string into an OpenCV BGR image."""
    if "," in base64_img:
        base64_img = base64_img.split(",")[1]
    img_bytes = base64.b64decode(base64_img)
    np_arr    = np.frombuffer(img_bytes, np.uint8)
    return cv2.imdecode(np_arr, cv2.IMREAD_COLOR)


def extract_pose(base64_img: str) -> dict:
    """
    Extract MediaPipe Pose landmarks from a base64 frame.

    Returns:
        {
            "valid":       bool,
            "raw":         list[list[float]]  # 33 × [x, y, z, vis]
            "normalized":  list[list[float]]  # body-relative normalized 33 × [x, y, z, vis]
            "bbox":        dict | None        # normalized {x, y, w, h}
            "frame_shape": [H, W]
        }
    """
    default = {"valid": False, "raw": [], "normalized": [], "bbox": None, "frame_shape": []}
    try:
        img = decode_frame(base64_img)
        if img is None:
            return default

        H, W = img.shape[:2]
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

        pose = get_pose()
        results = pose.process(img_rgb)

        if not results.pose_landmarks:
            return default

        lms = results.pose_landmarks.landmark

        # ── Raw landmarks [x, y, z, visibility] (0–1 normalised by MediaPipe) ──
        raw = [[lm.x, lm.y, lm.z, lm.visibility] for lm in lms]

        # ── Check if key landmarks are visible enough ─────────────────────────
        key_ids = [_LEFT_HIP, _RIGHT_HIP, _LEFT_SHOULDER, _RIGHT_SHOULDER]
        for kid in key_ids:
            if raw[kid][3] < _MIN_VISIBILITY:
                return default  # reject frame — key structure not visible

        # ── Body-relative normalization ────────────────────────────────────────
        # Origin = hip centre; scale = torso length (hip→shoulder midpoint distance)
        hip_cx = (raw[_LEFT_HIP][0]  + raw[_RIGHT_HIP][0])  / 2
        hip_cy = (raw[_LEFT_HIP][1]  + raw[_RIGHT_HIP][1])  / 2
        sho_cx = (raw[_LEFT_SHOULDER][0] + raw[_RIGHT_SHOULDER][0]) / 2
        sho_cy = (raw[_LEFT_SHOULDER][1] + raw[_RIGHT_SHOULDER][1]) / 2

        torso_len = max(abs(sho_cy - hip_cy), 1e-6)   # avoid /0

        normalized = []
        for lm in raw:
            nx = (lm[0] - hip_cx) / torso_len
            ny = (lm[1] - hip_cy) / torso_len
            nz = lm[2] / torso_len
            normalized.append([nx, ny, nz, lm[3]])

        # ── Bounding box (from visible landmarks) ─────────────────────────────
        vis_pts = [(lm[0], lm[1]) for lm in raw if lm[3] >= _MIN_VISIBILITY]
        if vis_pts:
            xs = [p[0] for p in vis_pts]
            ys = [p[1] for p in vis_pts]
            margin = 0.03
            bbox = {
                "x": round(max(0, min(xs) - margin), 4),
                "y": round(max(0, min(ys) - margin), 4),
                "w": round(min(1, max(xs) + margin) - max(0, min(xs) - margin), 4),
                "h": round(min(1, max(ys) + margin) - max(0, min(ys) - margin), 4),
            }
        else:
            bbox = None

        return {
            "valid":       True,
            "raw":         raw,
            "normalized":  normalized,
            "bbox":        bbox,
            "frame_shape": [H, W],
        }

    except Exception as e:
        print(f"[ERROR] extract_pose: {repr(e)}")
        return default
