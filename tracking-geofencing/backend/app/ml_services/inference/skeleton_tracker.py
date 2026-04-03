"""
tracking-geofencing/backend/app/ml_services/inference/skeleton_tracker.py

Upgraded: uses YOLOv8 for person bounding box detection
          AND MediaPipe Pose for skeleton presence confirmation.

Returns:
    {
        "present": bool,
        "bbox": {"x": float, "y": float, "w": float, "h": float} | None,
        "confidence": float | None,
        "keypoints": [[x, y, visibility], ...] | None   # normalized 0-1
    }
"""
import base64
import os
import cv2
import numpy as np
import mediapipe as mp
from mediapipe.python.solutions import pose as mp_pose
from ultralytics import YOLO

# ── Load models once at startup ───────────────────────────────────────────────
_YOLO_MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "..", "yolov8n.pt")
# Fallback to local dir if not found
if not os.path.exists(_YOLO_MODEL_PATH):
    _YOLO_MODEL_PATH = "yolov8n.pt"

_yolo = YOLO(_YOLO_MODEL_PATH)
_pose = mp_pose.Pose(min_detection_confidence=0.5, min_tracking_confidence=0.5)


def _decode_frame(base64_img: str):
    """Decode a base64 JPEG/PNG frame to an OpenCV BGR image."""
    if "," in base64_img:
        base64_img = base64_img.split(",")[1]
    img_bytes = base64.b64decode(base64_img)
    np_arr = np.frombuffer(img_bytes, np.uint8)
    return cv2.imdecode(np_arr, cv2.IMREAD_COLOR)


class SkeletonTracker:

    @staticmethod
    def detect_presence(base64_img: str) -> bool:
        """Legacy boolean API — kept for backwards compatibility."""
        result = SkeletonTracker.detect_with_bbox(base64_img)
        return result["present"]

    @staticmethod
    def detect_with_bbox(base64_img: str) -> dict:
        """
        Full detection:
        1. YOLO → find person bounding box (class 0 = person)
        2. MediaPipe Pose → confirm skeleton + extract keypoints for movement trail

        Returns normalised coords (0.0–1.0) relative to frame dimensions.
        """
        default = {
            "present": False,
            "bbox": None,
            "confidence": None,
            "keypoints": None,
        }

        try:
            img = _decode_frame(base64_img)
            if img is None:
                return default

            h, w = img.shape[:2]
            img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

            # ── Step 1: YOLO person detection ─────────────────────────────
            yolo_results = _yolo(img_rgb, verbose=False, classes=[0])  # class 0 = person
            best_bbox = None
            best_conf = 0.0

            for r in yolo_results:
                for box in r.boxes:
                    conf = float(box.conf[0])
                    if conf > best_conf:
                        best_conf = conf
                        x1, y1, x2, y2 = box.xyxy[0].tolist()
                        # Normalise to 0-1
                        best_bbox = {
                            "x": round(x1 / w, 4),
                            "y": round(y1 / h, 4),
                            "w": round((x2 - x1) / w, 4),
                            "h": round((y2 - y1) / h, 4),
                        }

            # ── Step 2: MediaPipe Pose for skeleton confirmation ──────────
            pose_results = _pose.process(img_rgb)
            keypoints = None

            if pose_results.pose_landmarks:
                # Extract the 33 landmark points as normalised [x, y, visibility]
                keypoints = [
                    [round(lm.x, 4), round(lm.y, 4), round(lm.visibility, 4)]
                    for lm in pose_results.pose_landmarks.landmark
                ]

                # If YOLO missed it, derive bbox from pose landmarks
                if best_bbox is None:
                    xs = [lm.x for lm in pose_results.pose_landmarks.landmark]
                    ys = [lm.y for lm in pose_results.pose_landmarks.landmark]
                    margin = 0.05
                    x_min = max(0.0, min(xs) - margin)
                    y_min = max(0.0, min(ys) - margin)
                    x_max = min(1.0, max(xs) + margin)
                    y_max = min(1.0, max(ys) + margin)
                    best_bbox = {
                        "x": round(x_min, 4),
                        "y": round(y_min, 4),
                        "w": round(x_max - x_min, 4),
                        "h": round(y_max - y_min, 4),
                    }
                    best_conf = 0.75  # Pose-derived confidence estimate

            present = best_bbox is not None or keypoints is not None

            return {
                "present": present,
                "bbox": best_bbox,
                "confidence": round(best_conf, 3) if best_conf else None,
                "keypoints": keypoints,
            }

        except Exception as e:
            print(f"[ERROR] SkeletonTracker.detect_with_bbox: {repr(e)}")
            return default
