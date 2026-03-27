"""
gateway-dashboard/backend/run.py
"""
import uvicorn, os
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=int(os.getenv("GATEWAY_BACKEND_PORT", 8005)), reload=True)
