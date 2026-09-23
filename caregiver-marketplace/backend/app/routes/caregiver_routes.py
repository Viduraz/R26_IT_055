"""
caregiver-marketplace/backend/app/routes/caregiver_routes.py
API endpoints for searching and managing caregiver profiles.
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from typing import List, Optional

from app.schemas.caregiver_schema import CaregiverPublicProfile, CaregiverProfileUpdate
from app.services.caregiver_service import CaregiverService
from app.middleware.verify_token import get_current_user

router = APIRouter()
caregiver_service = CaregiverService()


@router.get("/caregivers", response_model=List[CaregiverPublicProfile])
async def search_caregivers(
    specialization: Optional[str] = Query(None, description="Filter by specialization"),
    min_rating: Optional[float] = Query(None, description="Minimum caregiver rating"),
    max_hourly_rate: Optional[float] = Query(None, description="Maximum caregiver hourly rate"),
    service_area: Optional[str] = Query(None, description="Filter by service area"),
    language: Optional[str] = Query(None, description="Filter by language"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=50),
):
    """
    Search and filter caregivers listed in the marketplace.
    """
    results = await caregiver_service.search_caregivers(
        specialization=specialization,
        min_rating=min_rating,
        max_hourly_rate=max_hourly_rate,
        service_area=service_area,
        language=language,
        page=page,
        limit=limit,
    )
    return results


@router.get("/caregivers/{caregiver_id}", response_model=CaregiverPublicProfile)
async def get_caregiver_profile(caregiver_id: str):
    """
    Retrieve a specific caregiver's public profile details.
    """
    caregiver = await caregiver_service.get_caregiver_by_id(caregiver_id)
    if not caregiver:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Caregiver profile not found"
        )
    return caregiver


@router.put("/caregivers/profile", response_model=dict)
async def update_caregiver_profile(
    updates: CaregiverProfileUpdate,
    current_user: dict = Depends(get_current_user)
):
    """
    Update the authenticated caregiver's profile.
    Only users with role 'caregiver' can update their marketplace profile.
    """
    if current_user.get("role") != "caregiver":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only caregivers can update their marketplace profile"
        )

    user_id = current_user.get("sub") or current_user.get("id", "")
    success = await caregiver_service.update_marketplace_profile(
        user_id=user_id,
        updates=updates.dict(exclude_unset=True)
    )
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not update caregiver profile (no valid fields changed or database error)"
        )
        
    return {"status": "success", "message": "Caregiver profile updated successfully"}


@router.patch("/caregivers/{caregiver_id}/verify", response_model=dict)
async def verify_caregiver(
    caregiver_id: str,
    current_user: dict = Depends(get_current_user),
    action: str = "approved",
):
    """
    Admin-only: approve or reject a caregiver.
    action query param: 'approved' (default) | 'rejected'
    Only users with role 'admin' can call this endpoint.
    """
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admin users can verify caregivers.",
        )

    if action not in ("approved", "rejected"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="action must be 'approved' or 'rejected'.",
        )

    success = await caregiver_service.verify_caregiver(
        user_id=caregiver_id,
        action=action,
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Caregiver not found or already in that state.",
        )

    return {
        "status": "success",
        "caregiver_id": caregiver_id,
        "verification_status": action,
        "message": f"Caregiver has been {action}.",
    }

