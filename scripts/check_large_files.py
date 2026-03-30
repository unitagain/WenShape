#!/usr/bin/env python3
"""Guardrail for oversized source files.

This check is intentionally pragmatic:
- Keep a hard ceiling for new files.
- Allow legacy oversized files at a fixed baseline, but block further growth.
"""

from __future__ import annotations

import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
TARGET_SUFFIXES = {".py", ".js", ".jsx", ".ts", ".tsx"}
SKIP_DIRS = {".git", "node_modules", "dist", "build", "__pycache__"}

# Global hard ceilings for files without explicit baseline exceptions.
DEFAULT_LIMITS = {
    "backend": 800,
    "frontend": 1000,
}

# Existing oversized files are temporarily allowed up to baseline counts.
# Any growth beyond baseline fails CI.
BASELINE_LIMITS = {
    "backend/app/agents/archivist.py": 843,
    "backend/app/prompt_templates/archivist.py": 1297,
    "backend/app/orchestrator/orchestrator.py": 1336,
    "backend/app/agents/editor.py": 1255,
    "backend/app/agents/_fanfiction_mixin.py": 1187,
    "backend/app/services/crawler_service.py": 1103,
    "backend/app/services/evidence_service.py": 1026,
    "backend/app/services/chapter_binding_service.py": 929,
    "frontend/src/pages/WritingSession.jsx": 1771,
}


def should_skip(path: Path) -> bool:
    return any(part in SKIP_DIRS for part in path.parts)


def iter_files() -> list[Path]:
    files: list[Path] = []
    for path in REPO_ROOT.rglob("*"):
        if not path.is_file():
            continue
        if should_skip(path):
            continue
        if path.suffix.lower() not in TARGET_SUFFIXES:
            continue
        files.append(path)
    return files


def infer_default_limit(rel_path: str) -> int | None:
    if rel_path.startswith("backend/"):
        return DEFAULT_LIMITS["backend"]
    if rel_path.startswith("frontend/"):
        return DEFAULT_LIMITS["frontend"]
    return None


def line_count(path: Path) -> int:
    return len(path.read_text(encoding="utf-8").splitlines())


def main() -> int:
    violations: list[str] = []

    for path in iter_files():
        rel = path.relative_to(REPO_ROOT).as_posix()
        count = line_count(path)

        baseline_limit = BASELINE_LIMITS.get(rel)
        if baseline_limit is not None:
            if count > baseline_limit:
                violations.append(
                    f"{rel}: {count} lines (baseline cap {baseline_limit}; split this file before adding more logic)"
                )
            continue

        default_limit = infer_default_limit(rel)
        if default_limit is None:
            continue
        if count > default_limit:
            violations.append(
                f"{rel}: {count} lines (default limit {default_limit}; consider container/hook/helper extraction)"
            )

    if violations:
        print("Large-file check failed:")
        for item in violations:
            print(f"- {item}")
        return 1

    print("Large-file check passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
