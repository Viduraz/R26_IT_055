"""
caregiver-marketplace/backend/app/routes/booking_routes.py
API endpoints for creating and managing bookings.
"""
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from typing import List

from app.schemas.booking_schema import CreateBookingRequest, BookingResponse, ResendPatientIdRequest
from app.services.booking_service import BookingService
from app.services.notification_service import send_patient_id_email, send_patient_id_sms
from app.middleware.verify_token import get_current_user

router = APIRouter()
booking_service = BookingService()

async def dispatch_notifications(notify_email, notify_sms, booking, email_override=None, phone_override=None):
    if notify_email:
        family_email = email_override or booking.get("family_email")
        if family_email:
            email_sent = await send_patient_id_email(
                family_email=family_email,
                family_name=booking.get("family_name", "Family"),
                caregiver_name=booking.get("caregiver_name", "Caregiver"),
                elder_name=booking.get("elder", {}).get("name", "Elder"),
                patient_id=booking.get("patient_id"),
                booking_id=booking.get("booking_id")
            )
            if email_sent:
                await booking_service.mark_patient_id_sent(booking["booking_id"], "email")

    if notify_sms:
        phone = phone_override or booking.get("family_phone")
        if phone:
            sms_sent = await send_patient_id_sms(
                phone=phone,
                patient_id=booking.get("patient_id"),
                elder_name=booking.get("elder", {}).get("name", "Elder"),
                caregiver_name=booking.get("caregiver_name", "Caregiver")
            )
            if sms_sent:
                await booking_service.mark_patient_id_sent(booking["booking_id"], "sms")



@router.post("/bookings", response_model=BookingResponse, status_code=status.HTTP_201_CREATED)
async def create_booking(
    request: CreateBookingRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user)
):
    """
    Create a new caregiver booking. Generates a unique Patient ID and sends it to the user.
    """
    # JWT stores user ID as 'sub'; fall back to 'id' for compatibility
    user_id = current_user.get("sub") or current_user.get("id", "")

    # Prevent caregivers from booking other caregivers
    if current_user.get("role") == "caregiver":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Caregivers cannot book other caregivers"
        )

    # Convert request to dict and create booking
    booking = await booking_service.create_booking(
        family_user_id=user_id,
        payload=request.dict()
    )

    # Attempt to send Patient ID via chosen channels in the background
    background_tasks.add_task(
        dispatch_notifications,
        notify_email=request.notify_email,
        notify_sms=request.notify_sms,
        booking=booking,
        phone_override=request.family_phone
    )

    # Construct user-facing message
    channels = []
    if request.notify_email and booking.get("family_email"):
        channels.append("email")
    if request.notify_sms and (request.family_phone or booking.get("family_phone")):
        channels.append("sms")
        
    msg = f"Booking confirmed. Patient ID {booking['patient_id']} has been generated"
    if channels:
        msg += f" and delivery via {', '.join(channels)} has been initiated."
    else:
        msg += " (no delivery channels configured)."

    return BookingResponse(
        booking_id=booking["booking_id"],
        patient_id=booking["patient_id"],
        caregiver_name=booking["caregiver_name"],
        elder_name=booking["elder"]["name"],
        status=booking["status"],
        schedule=booking["schedule"],
        total_amount=booking["total_amount"],
        message=msg
    )


@router.get("/bookings", response_model=List[dict])
async def list_bookings(current_user: dict = Depends(get_current_user)):
    """
    Get all bookings related to the logged-in user (family member or caregiver).
    """
    user_id = current_user.get("sub") or current_user.get("id", "")
    return await booking_service.get_bookings_for_user(
        user_id=user_id,
        role=current_user.get("role", "family_member")
    )


@router.get("/bookings/{booking_id}", response_model=dict)
async def get_booking_details(
    booking_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Get detailed information about a specific booking.
    """
    booking = await booking_service.get_booking_by_id(booking_id)
    if not booking:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Booking not found"
        )
        
    # Verify ownership: current user must be the family member who booked or the caregiver
    if booking["family_user_id"] != current_user["id"] and booking["caregiver_user_id"] != current_user["id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to view this booking"
        )
        
    return booking


@router.post("/bookings/{booking_id}/cancel", response_model=dict)
async def cancel_booking(
    booking_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Cancel an active booking. Only the family member who made the booking can cancel it.
    """
    user_id = current_user.get("sub") or current_user.get("id", "")
    success = await booking_service.cancel_booking(
        booking_id=booking_id,
        user_id=user_id
    )
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not cancel booking. Either it doesn't exist, is already cancelled, or you are not authorized."
        )
    return {"status": "success", "message": "Booking cancelled successfully"}


@router.post("/bookings/{booking_id}/resend-id", response_model=dict)
async def resend_patient_id(
    booking_id: str,
    request: ResendPatientIdRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user)
):
    """
    Resend the Patient ID for an existing booking.
    """
    booking = await booking_service.get_booking_by_id(booking_id)
    if not booking:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Booking not found"
        )
        
    if booking["family_user_id"] != current_user["id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the booking creator can request Patient ID delivery"
        )

    channels = []
    if request.via_email and booking.get("family_email"):
        channels.append("email")
    if request.via_sms and (request.phone_override or booking.get("family_phone")):
        channels.append("sms")

    if not channels:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No valid delivery channels specified or found."
        )

    background_tasks.add_task(
        dispatch_notifications,
        notify_email=request.via_email,
        notify_sms=request.via_sms,
        booking=booking,
        phone_override=request.phone_override
    )

    return {"status": "success", "message": f"Patient ID resend via {', '.join(channels)} initiated."}
