#!/usr/bin/env python3
"""Enforce backend dependency file policy.

Policy:
1) requirements.lock is the only dependency source of truth.
2) requirements.txt must only include requirements.lock.
3) requirements.lock entries must be pinned (==).
"""

from __future__ import annotations

import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
REQ_FILE = REPO_ROOT / "backend" / "requirements.txt"
LOCK_FILE = REPO_ROOT / "backend" / "requirements.lock"

REQ_INCLUDE_ALLOWED = {"-r requirements.lock", "--requirement requirements.lock"}


def is_comment_or_empty(line: str) -> bool:
    stripped = line.strip()
    return not stripped or stripped.startswith("#")


def normalize_requirement_line(line: str) -> str:
    return " ".join(line.strip().split())


def validate_requirements_entrypoint() -> list[str]:
    errors: list[str] = []
    include_lines: list[str] = []
    for raw in REQ_FILE.read_text(encoding="utf-8").splitlines():
        line = normalize_requirement_line(raw)
        if is_comment_or_empty(line):
            continue
        include_lines.append(line)

    if len(include_lines) != 1:
        errors.append(
            "backend/requirements.txt must contain exactly one non-comment line that includes requirements.lock."
        )
        return errors

    include = include_lines[0].lower()
    if include not in REQ_INCLUDE_ALLOWED:
        errors.append(
            "backend/requirements.txt must be '-r requirements.lock' (or '--requirement requirements.lock')."
        )
    return errors


def validate_lockfile_pins() -> list[str]:
    errors: list[str] = []
    for idx, raw in enumerate(LOCK_FILE.read_text(encoding="utf-8").splitlines(), start=1):
        line = normalize_requirement_line(raw)
        if is_comment_or_empty(line):
            continue
        if line.startswith("-"):
            errors.append(f"backend/requirements.lock:{idx} must be a pinned package line, got option: {line}")
            continue
        if "==" not in line:
            errors.append(f"backend/requirements.lock:{idx} must be pinned with '==': {line}")
    return errors


def main() -> int:
    errors = []
    errors.extend(validate_requirements_entrypoint())
    errors.extend(validate_lockfile_pins())

    if not errors:
        print("Requirements sync check passed.")
        return 0

    print("Requirements sync check failed:")
    for err in errors:
        print(f"- {err}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
