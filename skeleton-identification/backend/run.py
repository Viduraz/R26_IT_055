"""
run.py
Shim entry point for skeleton-identification backend.
Allows start-all.ps1 to launch this service the same way as all other backends
(i.e., `python run.py`), without needing a special case for run_all_services.py.
"""
import sys

# ── Windows Unicode fix ───────────────────────────────────────────────────────
# PowerShell defaults to cp1252 which crashes on box-drawing chars / emoji.
# Reconfigure stdout/stderr to UTF-8 before any print() calls.
for _stream in (sys.stdout, sys.stderr):
    if _stream and hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

from run_all_services import main

if __name__ == "__main__":
    main()
