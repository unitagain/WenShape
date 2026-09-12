"""Pytest configuration for WenShape backend tests."""

import os
import sys
import gc
import warnings
from pathlib import Path

import pytest

# Ensure the backend package is importable
backend_root = Path(__file__).resolve().parent.parent
if str(backend_root) not in sys.path:
    sys.path.insert(0, str(backend_root))

# Keep tests independent from the developer's local shell environment.
os.environ.setdefault("DEBUG", "false")
os.environ.setdefault("HOST", "127.0.0.1")
os.environ.setdefault("PORT", "8000")
os.environ.setdefault("WENSHAPE_LLM_PROVIDER", "openai")


@pytest.hookimpl(hookwrapper=True, trylast=True)
def pytest_runtest_teardown(item):
    """Finalize the known Python 3.13 Windows event-loop wakeup socket at its test boundary."""

    yield
    module_name = str(getattr(item.module, "__name__", ""))
    affected = module_name in {"test_storage", "test_character_relations", "tests.test_storage", "tests.test_character_relations"}
    if sys.platform == "win32" and sys.version_info[:2] >= (3, 13) and affected:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", ResourceWarning)
            gc.collect()
