"""
face-verification/backend/app/routes/face_routes.py
"""
from fastapi import APIRouter, Depends
from app.controllers.face_controller import verify_face, get_logs, get_authorized_persons
from app.middleware.verify_token import get_current_user

router = APIRouter()


@router.post("/verify", summary="Run face verification on a frame")
async def _verify(user=Depends(get_current_user)):
    return await verify_face(user)


@router.get("/logs", summary="Get face verification logs")
async def _logs(user=Depends(get_current_user)):
    return await get_logs(user)


@router.get("/authorized", summary="List authorized persons")
async def _authorized(user=Depends(get_current_user)):
    return await get_authorized_persons(user)
