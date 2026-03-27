"""
face-verification/backend/app/services/face_service.py
Service layer connecting Face endpoints to the ML embedder model.
"""
from fastapi import HTTPException, status
import numpy as np

from app.schemas.face_schema import EnrollFaceRequest, VerifyFaceRequest
from app.ml_services.inference.face_embedder import get_embedding, calculate_similarity

# Cosine similarity threshold for InceptionResnetV1 on vggface2
# Typically a high threshold prevents false positives. Range [-1.0, 1.0]
SIMILARITY_THRESHOLD = 0.65 


class FaceService:
    @staticmethod
    def enroll_face(payload: EnrollFaceRequest) -> dict:
        embeddings = []
        # Process each sample
        for base64_img in payload.samples:
            emb = get_embedding(base64_img)
            if emb is not None:
                embeddings.append(emb)
        
        if not embeddings:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No completely visible faces detected across any of the provided samples. Please re-enroll in better lighting."
            )

        # Average the embeddings to create a single robust profile vector
        arr = np.array(embeddings)
        mean_embedding = np.mean(arr, axis=0)

        # Normalize the averaged embedding
        norm = np.linalg.norm(mean_embedding)
        if norm > 0:
            mean_embedding = mean_embedding / norm

        return {
            "message": "Face profiles successfully aggregated.",
            "embedding": mean_embedding.tolist(),
            "processed_samples": len(embeddings)
        }

    @staticmethod
    def verify_face(payload: VerifyFaceRequest) -> dict:
        live_emb = get_embedding(payload.live_sample)
        if live_emb is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No face detected in the live camera feed."
            )

        similarity = calculate_similarity(live_emb, payload.stored_embedding)
        
        matched = similarity >= SIMILARITY_THRESHOLD
        
        # Determine confidence percent strictly for display analytics based on empirical standard deviations
        confidence = max(0.0, min(100.0, ((similarity + 1.0) / 2.0) * 100))

        return {
            "matched": matched,
            "similarity": round(similarity, 4),
            "confidence": round(confidence, 2)
        }
