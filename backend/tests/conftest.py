"""Pytest configuration for WenShape backend tests."""

import os
import sys
from pathlib import Path

# Ensure the backend package is importable
backend_root = Path(__file__).resolve().parent.parent
if str(backend_root) not in sys.path:
    sys.path.insert(0, str(backend_root))

# Keep tests independent from the developer's local shell environment.
os.environ.setdefault("DEBUG", "false")
os.environ.setdefault("HOST", "127.0.0.1")
os.environ.setdefault("PORT", "8000")
os.environ.setdefault("WENSHAPE_LLM_PROVIDER", "openai")
