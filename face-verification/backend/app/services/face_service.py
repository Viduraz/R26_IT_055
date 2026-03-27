"""
face-verification/backend/app/services/face_service.py
Orchestrates MTCNN detection + FaceNet embedding + cosine similarity verification.
"""
from datetime import datetime
from shared.backend.config.database import get_db


def _logs_col():
    return get_db()["face_logs"]


def _persons_col():
    return get_db()["authorized_persons"]


class FaceService:
    async def run_verification(self, user_id: str) -> dict:
        """
        TODO: Accept frame bytes, run detection + embedding, compare with known embeddings.
        1. Preprocess frame (face_preprocess.py)
        2. Detect face (detect_face.py via MTCNN)
        3. Extract embedding (extract_embedding.py via FaceNet)
        4. Compare with stored embeddings (verify_identity.py)
        5. Log result to MongoDB
        """
        log = {
            "user_id": user_id,
            "status": "pending",   # TODO: replace with actual result
            "match": None,
            "confidence": 0.0,
            "timestamp": datetime.utcnow(),
        }
        _logs_col().insert_one(log)
        return {"message": "Verification pipeline stub — implement ML inference.", "log_id": str(log.get("_id", ""))}

    async def fetch_logs(self) -> list:
        logs = list(_logs_col().find({}, {"_id": 0}).sort("timestamp", -1).limit(50))
        return logs

    async def fetch_authorized_persons(self) -> list:
        persons = list(_persons_col().find({}, {"_id": 0}))
        return persons
