"""
anomaly-detection/backend/app/ml_services/inference/extract_pose.py
Extract MediaPipe pose keypoints from a frame.
"""
from app.ml_services.models.mediapipe_pose import get_pose


def extract_keypoints(frame_rgb) -> list:
    """
    Args:
        frame_rgb: numpy (H, W, 3) RGB frame.
    Returns:
        Flat list of [x, y, z, visibility] for 33 keypoints = 132 values.
    """
    pose = get_pose()
    if pose is None:
        return []  # TODO: remove stub once MediaPipe is initialised
    results = pose.process(frame_rgb)
    if not results.pose_landmarks:
        return []
    kps = []
    for lm in results.pose_landmarks.landmark:
        kps.extend([lm.x, lm.y, lm.z, lm.visibility])
    return kps
