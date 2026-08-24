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
        self._skeleton_service_url = os.getenv("SKELETON_SERVICE_URL", "http://localhost:8005")

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
            
            # 1. Send face samples to Face Verification Service
            try:
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
                try: error_msg = e.response.json().get("detail", e.response.text)
                except: error_msg = e.response.text
                print(f"[ERROR] Face Model Error response: {error_msg}")
                raise HTTPException(status_code=e.response.status_code, detail=f"Face Model Error: {error_msg}")
            except Exception as e:
                print(f"[ERROR] Unexpected error processing face samples: {repr(e)}")
                raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to process face samples: {repr(e)}")

            # 2. Send skeleton samples to Skeleton Identification Service & trigger model training
            if payload.skeleton_samples and len(payload.skeleton_samples) > 0:
                try:
                    async with httpx.AsyncClient(timeout=60.0) as client:
                        # Create user in Skeleton system
                        sk_user_resp = await client.post(
                            f"{self._skeleton_service_url}/api/users/",
                            json={
                                "name": payload.name,
                                "email": payload.email,
                                "role": payload.role,
                                "notes": f"Caregiver ID: {payload.caregiver_license_or_staff_id or 'N/A'}"
                            }
                        )
                        if sk_user_resp.status_code in (200, 201):
                            sk_user_data = sk_user_resp.json()
                            sk_user_id = sk_user_data.get("user_id")

                            if sk_user_id:
                                # Extract keypoint features & upsert profile
                                enroll_resp = await client.post(
                                    f"{self._skeleton_service_url}/api/enroll/user-images",
                                    json={"user_id": sk_user_id, "frames": payload.skeleton_samples}
                                )
                                print(f"[INFO] Skeleton enrollment status: {enroll_resp.status_code}")
                                
                                # Retrain SVM/LSTM ensemble model for the newly registered user
                                train_resp = await client.post(
                                    f"{self._skeleton_service_url}/api/train",
                                    json={"model_type": "ensemble"}
                                )
                                print(f"[INFO] Skeleton AI training triggered: {train_resp.status_code}")
                                user_doc["skeleton_verification_status"] = "enrolled"
                except Exception as e:
                    print(f"[WARNING] Skeleton enrollment / training connection issue: {repr(e)}")
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

        # 1. Face Verification
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

        # 2. Skeleton Verification (if sample provided)
        if payload.live_skeleton_sample:
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    # Note: SKELETON_SERVICE_URL usually points to the gateway (8080 or 8005)
                    # We need to find the user in skeleton system by email to get their user_id
                    skeleton_user_resp = await client.get(f"{self._skeleton_service_url}/api/users/")
                    skeleton_user_resp.raise_for_status()
                    skeleton_users = skeleton_user_resp.json()
                    
                    target_skeleton_user_id = next(
                        (u["user_id"] for u in skeleton_users if u["email"] == user["email"]), 
                        None
                    )
                    
                    if not target_skeleton_user_id:
                        print(f"[WARNING] User {user['email']} not found in Skeleton System.")
                        # If not enrolled in skeleton, we might want to skip or fail.
                        # For now, let's just log it and proceed if face was OK, or fail if required.
                    else:
                        resp = await client.post(
                            f"{self._skeleton_service_url}/api/verify-frame",
                            json={"frame": payload.live_skeleton_sample}
                        )
                        resp.raise_for_status()
                        skeleton_data = resp.json()
                        
                        if not skeleton_data.get("matched"):
                            raise HTTPException(
                                status_code=status.HTTP_401_UNAUTHORIZED,
                                detail=f"Skeleton verification failed: {skeleton_data.get('detail', 'Unknown error')}"
                            )
                        
                        predicted_uid = skeleton_data.get("predicted_user")
                        if predicted_uid != target_skeleton_user_id:
                            raise HTTPException(
                                status_code=status.HTTP_401_UNAUTHORIZED,
                                detail="Skeleton verification failed: Identity mismatch"
                            )
                        
                        print(f"[INFO] Skeleton verification successful for {user['email']}")

            except httpx.HTTPStatusError as e:
                print(f"[ERROR] Skeleton Verification Service Error: {e.response.text}")
                # We can decide if skeleton verification is mandatory
                # raise HTTPException(status_code=e.response.status_code, detail="Skeleton Verification Service Error")
            except Exception as e:
                print(f"[ERROR] Unexpected Skeleton verification issue: {repr(e)}")

        token = create_access_token({"sub": str(user["_id"]), "email": user["email"], "role": user.get("role", "user")})
        return {"access_token": token, "token_type": "bearer"}
