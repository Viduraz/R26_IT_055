"""
anomaly-detection/backend/app/ml_services/models/mediapipe_pose.py
MediaPipe Pose model loader.
"""
# import mediapipe as mp

_pose = None


def get_pose():
    global _pose
    if _pose is None:
        # mp_pose = mp.solutions.pose
        # _pose = mp_pose.Pose(static_image_mode=False, min_detection_confidence=0.5)
        pass  # TODO: initialise MediaPipe Pose
    return _pose
