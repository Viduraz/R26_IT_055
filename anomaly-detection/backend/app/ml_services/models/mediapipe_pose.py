"""
anomaly-detection/backend/app/ml_services/models/mediapipe_pose.py
MediaPipe Pose model — initialized once at startup, reused across requests.
"""
import mediapipe as mp

_pose = None


def get_pose():
    """Singleton: returns the initialized MediaPipe Pose instance."""
    global _pose
    if _pose is None:
        mp_pose = mp.solutions.pose
        _pose = mp_pose.Pose(
            static_image_mode=False,
            model_complexity=1,
            smooth_landmarks=True,
            enable_segmentation=False,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
    return _pose
