import sys
import uvicorn
import os
from pathlib import Path
from dotenv import load_dotenv

# Add project root to python path so it can find the "shared" module
root_dir = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root_dir))
os.environ["PYTHONPATH"] = str(root_dir) + os.pathsep + os.environ.get("PYTHONPATH", "")

load_dotenv(root_dir / ".env")

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=int(os.getenv("GATEWAY_BACKEND_PORT", 8005)), reload=True)
