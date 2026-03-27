"""
auth-service/backend/app/services/auth_service.py
Core authentication business logic.
"""
from datetime import datetime
import httpx
import os

from fastapi import HTTPException, status

from app.models.user_model import user_collection
from app.schemas.auth_schema import RegisterRequest, LoginRequest, FaceLoginRequest
from app.services.password_service import hash_password, verify_password
from app.services.user_service import UserService
from shared.backend.auth.jwt_handler import create_access_token


class AuthService:
    def __init__(self):
        self._user_service = UserService()
        self._face_service_url = os.getenv("FACE_SERVICE_URL", "http://localhost:8001")

    async def register(self, payload: RegisterRequest) -> dict:
        # Check for duplicate email
        existing = await self._user_service.get_by_email(payload.email)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Email already registered.",
            )

        hashed_pw = hash_password(payload.password)
        
        user_doc = {
            "name": payload.name,
            "email": payload.email,
            "password_hash": hashed_pw,
            "role": payload.role,
            "id_number": payload.id_number,
            "contact_number": payload.contact_number,
            "date_of_birth": payload.date_of_birth,
            "gender": payload.gender,
            "permanent_address": payload.permanent_address,
            "office_address": payload.office_address,
            "relationship_to_elder": payload.relationship_to_elder,
            "emergency_contact_name": payload.emergency_contact_name,
            "emergency_contact_number": payload.emergency_contact_number,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }

        # Caregiver specific enrollment logic
        if payload.role == "caregiver":
            if not payload.face_samples or len(payload.face_samples) == 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Face samples are required for Caregiver registration."
                )
            
            # Send base64 samples to Face Verification Service to extract embeddings
            try:
                # Expand timeout to 60s because MTCNN + Resnet CPU inference on 5 images takes time
                async with httpx.AsyncClient(timeout=60.0) as client:
                    resp = await client.post(
                        f"{self._face_service_url}/api/face/enroll",
                        json={"samples": payload.face_samples}
                    )
                    resp.raise_for_status()
                    embed_data = resp.json()
                    user_doc["face_embeddings"] = embed_data.get("embedding")
                    user_doc["face_verification_status"] = "enrolled"
                    user_doc["face_verification_required"] = True
            
            except httpx.HTTPStatusError as e:
                # Pull the verbose error message from the Face ML Service if it failed validation
                try:
                    error_msg = e.response.json().get("detail", e.response.text)
                except:
                    error_msg = e.response.text
                print(f"[ERROR] Face Model Error response: {error_msg}")
                raise HTTPException(
                    status_code=e.response.status_code,
                    detail=f"Face Model Error: {error_msg}"
                )
            except httpx.RequestError as e:
                print(f"[ERROR] Failed to reach Face ML Service: {repr(e)}")
                # Catches ReadTimeout, ConnectError, etc which usually have blank str(e)
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Failed to reach Face ML Service: {repr(e)}"
                )
            except Exception as e:
                print(f"[ERROR] Unexpected error processing face samples: {repr(e)}")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Failed to process face samples: {repr(e)}"
                )
        else:
            user_doc["face_verification_required"] = False

        result = user_collection().insert_one(user_doc)
        return {"message": f"{payload.role.capitalize()} registered successfully.", "user_id": str(result.inserted_id)}

    async def login(self, payload: LoginRequest) -> dict | None:
        user = await self._user_service.get_by_email(payload.email)
        if not user or not verify_password(payload.password, user["password_hash"]):
            return None

        if user.get("role") == "caregiver":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Caregivers must use the face verification login endpoint."
            )

        token = create_access_token({"sub": str(user["_id"]), "email": user["email"], "role": user.get("role", "user")})
        return {"access_token": token, "token_type": "bearer"}

    async def login_with_face(self, payload: FaceLoginRequest) -> dict | None:
        user = await self._user_service.get_by_email(payload.email)
        if not user or not verify_password(payload.password, user["password_hash"]):
            return None

        # Call ML Service to verify the live face sample against stored embedding
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    f"{self._face_service_url}/api/face/verify",
                    json={
                        "live_sample": payload.live_face_sample,
                        "stored_embedding": user.get("face_embeddings")
                    }
                )
                resp.raise_for_status()
                verify_data = resp.json()
                if not verify_data.get("matched"):
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED, 
                        detail=f"Face verification failed. Confidence: {verify_data.get('confidence', 0)}%"
                    )
        except httpx.HTTPStatusError as e:
            try:
                error_msg = e.response.json().get("detail", e.response.text)
            except:
                error_msg = e.response.text
            print(f"[ERROR] Face Model Verification Error: {error_msg}")
            raise HTTPException(
                status_code=e.response.status_code,
                detail=f"Face Model Error: {error_msg}"
            )
        except HTTPException:
            raise
        except Exception as e:
            print(f"[ERROR] Unexpected Face verification connection issue: {repr(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Face verification connection issue: {repr(e)}"
            )

        token = create_access_token({"sub": str(user["_id"]), "email": user["email"], "role": user.get("role", "user")})
        return {"access_token": token, "token_type": "bearer"}
