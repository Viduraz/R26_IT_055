"""
face-verification/backend/app/ml_services/inference/detect_face.py
Detect faces in a frame using MTCNN.
"""
# import numpy as np
from app.ml_services.models.mtcnn_model import get_mtcnn


def detect_faces(frame_rgb) -> list:
    """
    Detect faces in an RGB numpy array.

    Args:
        frame_rgb: np.ndarray (H, W, 3) in RGB format.

    Returns:
        List of bounding boxes [[x1, y1, x2, y2], ...].
    """
    mtcnn = get_mtcnn()
    if mtcnn is None:
        return []  # TODO: remove stub when MTCNN is initialised
    boxes, _ = mtcnn.detect(frame_rgb)
    return boxes.tolist() if boxes is not None else []
