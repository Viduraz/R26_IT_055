"""
tracking-geofencing/backend/app/ml_services/inference/skeleton_tracker.py
Wraps the Google MediaPipe Pose engine to strictly verify if a human is standing inside the camera frame.
"""
import base64
import cv2
import numpy as np
import numpy as np
import mediapipe as mp
from mediapipe.python.solutions import pose as mp_pose
# Initialize globally to avoid heavy booting on each API hit
pose = mp_pose.Pose(min_detection_confidence=0.5, min_tracking_confidence=0.5)

class SkeletonTracker:
    @staticmethod
    def detect_presence(base64_img: str) -> bool:
        try:
            if "," in base64_img:
                base64_img = base64_img.split(",")[1]
            img_bytes = base64.b64decode(base64_img)
            np_arr = np.frombuffer(img_bytes, np.uint8)
            img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
            
            if img is None:
                return False
                
            img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            results = pose.process(img_rgb)
            
            # If landmarks are found, a human skeleton is structurally present
            if results.pose_landmarks:
                return True
            return False
        except Exception as e:
            print(f"[ERROR] Skeleton Tracker failure: {repr(e)}")
            return False
