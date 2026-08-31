"""
auth-service/backend/app/middleware/cors.py
CORS configuration helper (applied in main.py via CORSMiddleware).
"""
# Wildcard allows any origin (Cloudflare tunnel, localhost, teammates' browsers).
# Authentication uses JWT Bearer tokens in headers — not cookies — so
# allow_credentials=False is required and does not break anything.
CORS_ORIGINS = ["*"]
