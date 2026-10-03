"""Run the incremental type gate for backend kernel contracts."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def main() -> int:
    backend = Path(__file__).resolve().parents[1]
    completed = subprocess.run([sys.executable, "-m", "mypy"], cwd=backend, check=False)
    return int(completed.returncode)


if __name__ == "__main__":
    raise SystemExit(main())
