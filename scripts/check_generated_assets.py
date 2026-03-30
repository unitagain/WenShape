#!/usr/bin/env python3
"""Fail if generated frontend/backend assets are tracked in git."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN_PREFIXES = (
    "dist/",
    "build/",
    "frontend/dist/",
    "frontend/build/",
    "backend/static/",
    "backend/static/assets/",
)


def git_tracked_files() -> list[str]:
    cmd = ["git", "ls-files"]
    proc = subprocess.run(cmd, cwd=REPO_ROOT, check=True, capture_output=True, text=True)
    return [line.strip() for line in proc.stdout.splitlines() if line.strip()]


def main() -> int:
    tracked = git_tracked_files()
    hits = [path for path in tracked if path.startswith(FORBIDDEN_PREFIXES)]
    if not hits:
        print("Generated assets check passed.")
        return 0

    print("Generated assets check failed. Tracked build outputs found:")
    for path in hits:
        print(f"- {path}")
    print("Keep these directories as build outputs only, not tracked source files.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
