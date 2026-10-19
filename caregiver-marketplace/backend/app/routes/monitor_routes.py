"""
caregiver-marketplace/backend/app/routes/monitor_routes.py
API endpoints for monitoring patient status by Patient ID.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.services.monitor_service import MonitorService
from app.middleware.verify_token import get_current_user

router = APIRouter()
monitor_service = MonitorService()


@router.get("/monitor/validate/{patient_id}", response_model=dict)
async def validate_patient(
    patient_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Validate if a given Patient ID is active and authorized for the logged-in user.
    """
    # JWT encodes the user's MongoDB _id under the standard 'sub' key.
    # Using current_user["id"] caused a KeyError → 500 on every call.
    booking = await monitor_service.validate_patient_id(
        patient_id, current_user.get("sub", "")
    )
    if not booking:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Valid booking not found for this Patient ID, or you are not authorized to access it."
        )
    return {
        "status": "valid",
        "booking_id": booking["booking_id"],
        "elder_name": booking["elder"]["name"],
        "caregiver_name": booking["caregiver_name"]
    }


@router.get("/monitor/status/{patient_id}", response_model=dict)
async def get_patient_live_status(
    patient_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Fetch aggregated live status for the patient. Must be authorized.
    """
    booking = await monitor_service.validate_patient_id(
        patient_id, current_user.get("sub", "")
    )
    if not booking:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to monitor this Patient ID."
        )

    status_data = await monitor_service.get_live_status(patient_id)
    return status_data


@router.get("/monitor/video-frame/{patient_id}", response_model=dict)
async def get_patient_video_frame(
    patient_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user)
):
    """
    Proxy a single live JPEG frame from the anomaly-detection camera-snapshot endpoint.
    Validates the patient ID belongs to the requesting user before proxying.
    Returns: { "frame": "data:image/jpeg;base64,..." }
    """
    # Extract the raw JWT from the Authorization header to forward downstream
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()

    return await monitor_service.get_video_frame(
        patient_id, current_user.get("sub", ""), token
    )
