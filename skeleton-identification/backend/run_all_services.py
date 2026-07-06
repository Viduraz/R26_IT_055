"""
run_all_services.py
Launcher script that starts the API Gateway (which bundles all services).

In production, each service would run independently. For development,
we run everything in a single process via the gateway.

Usage:
    python run_all_services.py
"""
import sys
import os
from pathlib import Path

# backend/ directory IS the Python root (contains config.py, gateway/, services/, etc.)
project_root = Path(__file__).resolve().parent   # → research-skeleton/backend/
sys.path.insert(0, str(project_root))
os.chdir(str(project_root))

# Load .env from workspace root (two levels above backend/) or fall back to project root
from dotenv import load_dotenv
_env_file = project_root.parent.parent / ".env"  # → workspace root .env
if _env_file.exists():
    print(f"Loading environment from root .env: {_env_file}")
    load_dotenv(dotenv_path=str(_env_file))
else:
    _env_file = project_root.parent / ".env"      # → research-skeleton/.env
    print(f"Loading environment from local .env: {_env_file}")
    load_dotenv(dotenv_path=str(_env_file))

from config import settings


def main():
    """Start the gateway service."""
    import uvicorn

    print("""
    ╔══════════════════════════════════════════════════════════╗
    ║                                                          ║
    ║   🦴  Skeleton-Based Person Identification System        ║
    ║                                                          ║
    ║   Gateway:    http://localhost:{port:<5s}                  ║
    ║   Dashboard:  http://localhost:{port:<5s}                  ║
    ║   API Docs:   http://localhost:{port:<5s}/docs              ║
    ║   Health:     http://localhost:{port:<5s}/health             ║
    ║                                                          ║
    ║   MongoDB:    {mongodb:<40s} ║
    ║                                                          ║
    ╚══════════════════════════════════════════════════════════╝
    """.format(
        port=str(settings.gateway_port),
        mongodb=settings.mongodb_uri[:40],
    ))

    uvicorn.run(
        "gateway.main:app",
        host="0.0.0.0",
        port=settings.gateway_port,
        reload=True,
        log_level="info",
    )


if __name__ == "__main__":
    main()
