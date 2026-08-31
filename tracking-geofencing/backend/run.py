import sys
import os
from pathlib import Path
import uvicorn
from dotenv import load_dotenv

# Add project root to python path so it can find the "shared" module
root_dir = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root_dir))
sys.path.insert(0, os.path.dirname(__file__))
os.environ["PYTHONPATH"] = str(root_dir) + os.pathsep + os.environ.get("PYTHONPATH", "")

load_dotenv(root_dir / ".env")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8002, reload=True)
