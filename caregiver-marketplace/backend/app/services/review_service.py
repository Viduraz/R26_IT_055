"""
caregiver-marketplace/backend/app/services/review_service.py
Review and rating system for caregivers.
"""
from datetime import datetime, timezone
from bson import ObjectId
from shared.backend.config.database import get_db
from app.services.caregiver_service import CaregiverService


class ReviewService:

    def __init__(self):
        self._caregiver_svc = CaregiverService()

    def _reviews(self):
        return get_db()["reviews"]

    def _bookings(self):
        return get_db()["bookings"]

    async def create_review(self, family_user_id: str, family_name: str, payload: dict) -> dict:
        """Create a review for a completed booking."""
        # Validate booking exists and belongs to this family member
        booking = self._bookings().find_one({
            "booking_id": payload["booking_id"],
            "family_user_id": family_user_id,
        })
        if not booking:
            raise ValueError("Booking not found or does not belong to you")

        # Check no duplicate review
        existing = self._reviews().find_one({
            "booking_id": payload["booking_id"],
            "family_user_id": family_user_id,
        })
        if existing:
            raise ValueError("You have already reviewed this booking")

        caregiver_user_id = booking["caregiver_user_id"]
        caregiver_name = booking.get("caregiver_name", "Unknown")

        review_doc = {
            "booking_id": payload["booking_id"],
            "caregiver_user_id": caregiver_user_id,
            "caregiver_name": caregiver_name,
            "family_user_id": family_user_id,
            "family_name": family_name,
            "rating": payload["rating"],
            "review_text": payload.get("review_text", ""),
            "created_at": datetime.now(timezone.utc),
        }

        result = self._reviews().insert_one(review_doc)
        review_doc["id"] = str(result.inserted_id)

        # Recalculate average rating for the caregiver
        all_reviews = list(self._reviews().find({"caregiver_user_id": caregiver_user_id}))
        total = len(all_reviews)
        avg_rating = sum(r["rating"] for r in all_reviews) / total if total > 0 else 0

        await self._caregiver_svc.update_rating(caregiver_user_id, avg_rating, total)

        review_doc["created_at"] = str(review_doc["created_at"])
        return review_doc

    async def get_reviews_for_caregiver(self, caregiver_user_id: str) -> list[dict]:
        """Get all reviews for a specific caregiver."""
        try:
            docs = list(
                self._reviews()
                .find({"caregiver_user_id": caregiver_user_id}, {"_id": 0})
                .sort("created_at", -1)
                .limit(50)
            )
            for doc in docs:
                if "created_at" in doc:
                    doc["created_at"] = str(doc["created_at"])
            return docs
        except Exception as e:
            print(f"[ERROR] review_service.get_for_caregiver: {repr(e)}")
            return []
