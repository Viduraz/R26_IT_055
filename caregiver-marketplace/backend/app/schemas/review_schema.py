"""
caregiver-marketplace/backend/app/schemas/review_schema.py
Pydantic models for the review/rating system.
"""
from pydantic import BaseModel, Field
from typing import Optional


class CreateReviewRequest(BaseModel):
    """Submit a review for a completed booking."""
    booking_id: str
    rating: int = Field(..., ge=1, le=5)
    review_text: Optional[str] = None


class ReviewResponse(BaseModel):
    """A single review."""
    id: str
    booking_id: str
    caregiver_name: str
    family_name: str
    rating: int
    review_text: Optional[str] = None
    created_at: str
