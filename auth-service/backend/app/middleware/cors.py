"""
auth-service/backend/app/middleware/cors.py
CORS configuration helper (applied in main.py via CORSMiddleware).
"""
CORS_ORIGINS = [
    "http://localhost:5173",  # auth frontend
    "http://localhost:5178",  # gateway frontend
    # Add production origins here
]
