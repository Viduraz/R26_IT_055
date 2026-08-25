"""
caregiver-marketplace/backend/app/routes/review_routes.py
API endpoints for caregiver reviews and ratings.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from typing import List

from app.schemas.review_schema import CreateReviewRequest, ReviewResponse
from app.services.review_service import ReviewService
from app.middleware.verify_token import get_current_user

router = APIRouter()
review_service = ReviewService()


@router.post("/reviews", response_model=ReviewResponse, status_code=status.HTTP_201_CREATED)
async def submit_review(
    request: CreateReviewRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Submit a review and rating for a caregiver.
    Only the family member who made the booking can submit a review.
    """
    if current_user.get("role") == "caregiver":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Caregivers cannot review other caregivers"
        )
        
    try:
        review = await review_service.create_review(
            family_user_id=current_user["id"],
            family_name=current_user.get("name", "Family Member"),
            payload=request.dict()
        )
        # Ensure we drop any mongo '_id' field before serializing
        review.pop("_id", None)
        return review
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An unexpected error occurred: {str(e)}"
        )


@router.get("/reviews/caregiver/{caregiver_id}", response_model=List[dict])
async def list_caregiver_reviews(caregiver_id: str):
    """
    Get all reviews and ratings submitted for a caregiver.
    """
    return await review_service.get_reviews_for_caregiver(caregiver_user_id=caregiver_id)
