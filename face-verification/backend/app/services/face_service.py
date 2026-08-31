"""
face-verification/backend/app/services/face_service.py
Service layer connecting Face endpoints to the ML embedder model.
"""
from fastapi import HTTPException, status
import numpy as np

from app.schemas.face_schema import EnrollFaceRequest, VerifyFaceRequest, VerifyCaregiverRequest
from app.ml_services.inference.face_embedder import get_embedding, calculate_similarity
from shared.backend.config.database import get_db
from app.services.session_service import SessionService
from app.models.face_log_model import face_log_collection
from datetime import datetime, timezone

# Cosine similarity threshold for InceptionResnetV1 on vggface2
# Tuned threshold (0.58) provides reliable recognition across webcams
SIMILARITY_THRESHOLD = 0.58 


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

    @staticmethod
    def verify_caregiver_search(payload: VerifyCaregiverRequest) -> dict:
        live_emb = get_embedding(payload.live_sample)
        if live_emb is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No face detected in the live camera feed."
            )

        db = get_db()
        # Find all enrolled users with face embeddings
        enrolled_users = list(db["users"].find({
            "face_embeddings": {"$exists": True, "$ne": None}
        }))

        best_match = None
        best_sim = -1.0

        for u in enrolled_users:
            stored_emb = u.get("face_embeddings")
            if stored_emb and isinstance(stored_emb, list) and len(stored_emb) > 0:
                sim = calculate_similarity(live_emb, stored_emb)
                if sim > best_sim:
                    best_sim = float(sim)
                    best_match = u

        matched = False
        confidence = 0.0
        session_data = None
        caregiver_details = None

        if best_match and best_sim >= SIMILARITY_THRESHOLD:
            matched = True
            confidence = max(0.0, min(100.0, ((best_sim + 1.0) / 2.0) * 100))
            caregiver_details = {
                "id": str(best_match["_id"]),
                "name": best_match.get("name", "Unknown Caregiver"),
                "email": best_match.get("email"),
                "role": best_match.get("role", "caregiver"),
                "id_number": best_match.get("id_number", best_match.get("caregiver_license_or_staff_id", "N/A")),
                "phone": best_match.get("contact_number", "N/A")
            }
            # Create tracking session handoff if role is caregiver
            if best_match.get("role", "caregiver") == "caregiver":
                try:
                    session_data = SessionService.create_and_handoff_session(
                        caregiver_id=str(best_match["_id"]),
                        caregiver_name=caregiver_details["name"]
                    )
                except Exception as e:
                    print(f"[WARN] Session handoff error: {e}")

        # Log into system audit trail
        log_entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "matched": matched,
            "similarity": best_sim,
            "confidence": float(confidence)
        }
        if matched and best_match:
            log_entry["matched_caregiver_id"] = str(best_match["_id"])
            log_entry["matched_caregiver_name"] = caregiver_details["name"]

        try:
            face_log_collection().insert_one(log_entry)
        except Exception as e:
            print(f"[WARN] face_log insert error: {e}")

        if matched:
            return {
                "verified": True,
                "message": "Caregiver biometric verified successfully",
                "similarity": round(best_sim, 4),
                "confidence": round(confidence, 2),
                "caregiver_details": caregiver_details,
                "session": session_data
            }
        else:
            return {
                "verified": False,
                "message": "User not verified",
                "similarity": round(best_sim, 4) if best_sim != -1.0 else 0.0,
                "confidence": round(confidence, 2),
                "caregiver_details": None,
                "session": None
            }
