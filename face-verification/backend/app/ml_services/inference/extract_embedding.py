"""
face-verification/backend/app/ml_services/inference/extract_embedding.py
Extract 512-d embedding from a detected face crop using FaceNet.
"""
from app.ml_services.models.facenet_model import get_facenet


def extract_embedding(face_tensor) -> list:
    """
    Args:
        face_tensor: torch.Tensor [1, 3, 160, 160] normalised face crop.
    Returns:
        List[float] — 512-dimensional embedding.
    """
    model = get_facenet()
    if model is None:
        return []  # TODO: remove stub when FaceNet is initialised
    embedding = model(face_tensor).detach().cpu().numpy().flatten()
    return embedding.tolist()
