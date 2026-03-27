"""
auth-service/backend/app/routes/auth_routes.py
HTTP route definitions for the Auth Service.
"""
from fastapi import APIRouter
from app.controllers.auth_controller import (
    register_user,
    login_user,
    login_with_face,
    get_profile,
)

router = APIRouter()

router.post("/register", summary="Register a new user")(register_user)
router.post("/login", summary="Login and receive JWT")(login_user)
router.post("/caregiver/verify-face-login", summary="Login with Face Verification for Caregiver")(login_with_face)
router.get("/me", summary="Get current user profile")(get_profile)
