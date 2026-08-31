"""
face-verification/backend/app/services/face_service.py
Service layer connecting Face endpoints to the ML embedder model.
"""
from fastapi import HTTPException, status
import numpy as np

from app.schemas.face_schema import EnrollFaceRequest, VerifyFaceRequest, VerifyCaregiverRequest
from app.ml_services.inference.face_embedder import get_embedding, get_all_embeddings, calculate_similarity
from shared.backend.config.database import get_db
from app.services.session_service import SessionService
from app.models.face_log_model import face_log_collection
from datetime import datetime, timezone

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

    @staticmethod
    def verify_caregiver_search(payload: VerifyCaregiverRequest) -> dict:
        multi_embs = get_all_embeddings(payload.live_sample)
        if not multi_embs:
            live_emb = get_embedding(payload.live_sample)
            if live_emb is not None:
                multi_embs = [live_emb]
            else:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="No face detected in the live camera feed."
                )

        db = get_db()
        caregivers = list(db["users"].find({
            "$or": [
                {"face_verification_status": "enrolled"},
                {"face_embeddings": {"$exists": True, "$ne": None}},
                {"enrollment_status": "completed"}
            ]
        }))

        verified_persons = []
        assigned_caregiver_ids = set()

        for live_emb in multi_embs:
            best_match = None
            best_sim = -1.0

            for c in caregivers:
                c_id = str(c["_id"])
                if c_id in assigned_caregiver_ids:
                    continue
                stored_emb = c.get("face_embeddings")
                if stored_emb:
                    sim = calculate_similarity(live_emb, stored_emb)
                    if sim > best_sim:
                        best_sim = float(sim)
                        best_match = c

            if best_match and best_sim >= SIMILARITY_THRESHOLD:
                c_id = str(best_match["_id"])
                assigned_caregiver_ids.add(c_id)
                confidence = max(0.0, min(100.0, ((best_sim + 1.0) / 2.0) * 100))
                c_details = {
                    "name": best_match.get("name", "Unknown"),
                    "email": best_match.get("email"),
                    "id_number": best_match.get("id_number", "N/A"),
                    "phone": best_match.get("contact_number", "N/A")
                }
                session_data = SessionService.create_and_handoff_session(
                    caregiver_id=c_id,
                    caregiver_name=c_details["name"]
                )
                verified_persons.append({
                    "verified": True,
                    "similarity": round(best_sim, 4),
                    "confidence": round(confidence, 2),
                    "caregiver_details": c_details,
                    "session": session_data
                })

        if verified_persons:
            primary = verified_persons[0]
            # Log primary match into system audit trail
            log_entry = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "matched": True,
                "similarity": primary["similarity"],
                "confidence": float(primary["confidence"]),
                "matched_caregiver_id": primary["session"]["caregiver_id"] if primary.get("session") else "",
                "matched_caregiver_name": primary["caregiver_details"]["name"]
            }
            try:
                face_log_collection().insert_one(log_entry)
            except Exception:
                pass

            return {
                "verified": True,
                "message": f"Verified {len(verified_persons)} caregiver(s)",
                "similarity": primary["similarity"],
                "confidence": primary["confidence"],
                "caregiver_details": primary["caregiver_details"],
                "session": primary["session"],
                "all_verified": verified_persons
            }
        else:
            return {
                "verified": False,
                "message": "User not verified",
                "similarity": 0.0,
                "confidence": 0.0,
                "caregiver_details": None,
                "session": None,
                "all_verified": []
            }
