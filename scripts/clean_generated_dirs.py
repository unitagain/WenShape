#!/usr/bin/env python3
"""Clean generated build outputs in workspace.

Default mode is dry-run for safety.
Use --apply to actually delete directories.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
GENERATED_DIRS = [
    "dist",
    "build",
    "frontend/dist",
    "frontend/build",
    "backend/static",
]


def resolve_targets() -> list[Path]:
    targets: list[Path] = []
    for rel in GENERATED_DIRS:
        path = (REPO_ROOT / rel).resolve()
        if path.exists():
            targets.append(path)
    return targets


def is_within_repo(path: Path) -> bool:
    try:
        path.relative_to(REPO_ROOT)
        return True
    except ValueError:
        return False


def main() -> int:
    apply_mode = "--apply" in sys.argv[1:]
    targets = resolve_targets()

    if not targets:
        print("No generated directories found.")
        return 0

    print("Generated directories:")
    for target in targets:
        rel = target.relative_to(REPO_ROOT).as_posix()
        print(f"- {rel}")

    if not apply_mode:
        print("Dry-run only. Re-run with --apply to delete these directories.")
        return 0

    for target in targets:
        if not is_within_repo(target):
            print(f"Skip unsafe target outside repo: {target}")
            continue
        shutil.rmtree(target, ignore_errors=False)
        rel = target.relative_to(REPO_ROOT).as_posix()
        print(f"Removed: {rel}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
