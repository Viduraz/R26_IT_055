"""
face-verification/backend/app/ml_services/inference/verify_identity.py
Compare query embedding against stored embeddings using cosine similarity.
"""
import numpy as np
from app.ml_services.utils.thresholds import FACE_THRESHOLD


def cosine_similarity(a: list, b: list) -> float:
    a, b = np.array(a), np.array(b)
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))


def verify_identity(query_embedding: list, known_embeddings: dict) -> dict:
    """
    Args:
        query_embedding: 512-d list from FaceNet.
        known_embeddings: {person_id: embedding_list}

    Returns:
        {"match": bool, "person_id": str | None, "confidence": float}
    """
    best_sim, best_id = 0.0, None
    for person_id, emb in known_embeddings.items():
        sim = cosine_similarity(query_embedding, emb)
        if sim > best_sim:
            best_sim, best_id = sim, person_id

    matched = best_sim >= FACE_THRESHOLD
    return {"match": matched, "person_id": best_id if matched else None, "confidence": round(best_sim, 4)}
