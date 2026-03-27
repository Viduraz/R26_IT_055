"""
auth-service/backend/app/routes/auth_routes.py
HTTP route definitions for the Auth Service.
"""
from fastapi import APIRouter
from app.controllers.auth_controller import (
    register_user,
    login_user,
    get_profile,
)

router = APIRouter()

router.post("/register", summary="Register a new user")(register_user)
router.post("/login", summary="Login and receive JWT")(login_user)
router.get("/me", summary="Get current user profile")(get_profile)
