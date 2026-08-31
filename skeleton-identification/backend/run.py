"""
run.py
Shim entry point for skeleton-identification backend.
Allows start-all.ps1 to launch this service the same way as all other backends
(i.e., `python run.py`), without needing a special case for run_all_services.py.
"""
from run_all_services import main

if __name__ == "__main__":
    main()
