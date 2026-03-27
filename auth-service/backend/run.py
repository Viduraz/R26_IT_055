"""
auth-service/backend/run.py
Dev server launcher for the Auth Service.
"""
import uvicorn
import os
from dotenv import load_dotenv
from pathlib import Path

# Load root .env
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

if __name__ == "__main__":
    port = int(os.getenv("AUTH_BACKEND_PORT", 8000))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=True)
