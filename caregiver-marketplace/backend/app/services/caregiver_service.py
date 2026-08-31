"""
caregiver-marketplace/backend/app/services/caregiver_service.py
Queries the existing `users` collection for caregivers and manages
marketplace profile fields.
"""
import traceback
from bson import ObjectId
from shared.backend.config.database import get_db


class CaregiverService:

    def _users(self):
        return get_db()["users"]

    async def search_caregivers(
        self,
        specialization: str | None = None,
        min_rating: float | None = None,
        max_hourly_rate: float | None = None,
        service_area: str | None = None,
        language: str | None = None,
        page: int = 1,
        limit: int = 20,
    ) -> list[dict]:
        """Search caregivers in the users collection with optional filters."""
        query: dict = {"role": "caregiver"}

        if specialization:
            query["specializations"] = specialization
        if min_rating is not None:
            query["rating"] = {"$gte": min_rating}
        if max_hourly_rate is not None:
            query["hourly_rate"] = {"$lte": max_hourly_rate}
        if service_area:
            query["service_area"] = {"$regex": service_area, "$options": "i"}
        if language:
            query["languages"] = language

        skip = (page - 1) * limit

        # Projection — exclude sensitive fields
        projection = {
            "password_hash": 0,
            "face_embeddings": 0,
        }

        try:
            cursor = self._users().find(query, projection).sort("rating", -1).skip(skip).limit(limit)
            results = []
            for doc in cursor:
                doc["id"] = str(doc.pop("_id"))
                # Safely serialise any non-JSON-friendly fields
                for k, v in list(doc.items()):
                    if isinstance(v, ObjectId):
                        doc[k] = str(v)
                    elif hasattr(v, "isoformat"):  # datetime
                        doc[k] = v.isoformat()
                results.append(doc)
            return results
        except Exception as e:
            traceback.print_exc()
            print(f"[ERROR] caregiver_service.search: {repr(e)}")
            return []

    async def get_caregiver_by_id(self, user_id: str) -> dict | None:
        """Get a single caregiver profile by user ID."""
        try:
            doc = self._users().find_one(
                {"_id": ObjectId(user_id), "role": "caregiver"},
                {"password_hash": 0, "face_embeddings": 0},
            )
            if doc:
                doc["id"] = str(doc.pop("_id"))
                if "created_at" in doc:
                    doc["created_at"] = str(doc["created_at"])
            return doc
        except Exception as e:
            print(f"[ERROR] caregiver_service.get_by_id: {repr(e)}")
            return None

    async def update_marketplace_profile(self, user_id: str, updates: dict) -> bool:
        """Update marketplace-specific profile fields for a caregiver."""
        # Only allow marketplace fields to be updated
        allowed_fields = {
            "bio", "specializations", "hourly_rate", "languages",
            "availability", "service_area", "profile_photo_url",
        }
        safe_updates = {k: v for k, v in updates.items() if k in allowed_fields and v is not None}

        if not safe_updates:
            return False

        try:
            result = self._users().update_one(
                {"_id": ObjectId(user_id), "role": "caregiver"},
                {"$set": safe_updates},
            )
            return result.modified_count > 0
        except Exception as e:
            print(f"[ERROR] caregiver_service.update_profile: {repr(e)}")
            return False

    async def update_rating(self, user_id: str, new_avg_rating: float, total_reviews: int) -> None:
        """Update a caregiver's aggregate rating (called after a new review)."""
        try:
            self._users().update_one(
                {"_id": ObjectId(user_id)},
                {"$set": {"rating": round(new_avg_rating, 2), "total_reviews": total_reviews}},
            )
        except Exception as e:
            print(f"[ERROR] caregiver_service.update_rating: {repr(e)}")

    async def verify_caregiver(self, user_id: str, action: str) -> bool:
        """
        Admin action: approve or reject a caregiver.
        Sets verification_status AND syncs face_verification_status so the
        existing card badge reflects the change immediately.
        action: 'approved' | 'rejected'
        """
        allowed = {"approved", "rejected"}
        if action not in allowed:
            return False
        # Mirror into face_verification_status so the existing card badge works
        face_status = "verified" if action == "approved" else "rejected"
        try:
            result = self._users().update_one(
                {"_id": ObjectId(user_id), "role": "caregiver"},
                {"$set": {
                    "verification_status": action,
                    "face_verification_status": face_status,
                }},
            )
            return result.modified_count > 0
        except Exception as e:
            print(f"[ERROR] caregiver_service.verify: {repr(e)}")
            return False

