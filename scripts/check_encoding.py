#!/usr/bin/env python3
"""Scan source files for likely mojibake markers."""

from __future__ import annotations

import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCAN_EXTENSIONS = {".py", ".md", ".js", ".jsx", ".ts", ".tsx", ".json", ".yaml", ".yml"}
SKIP_DIRS = {".git", "node_modules", "dist", "build", "__pycache__"}
SKIP_FILES = {"check_encoding.py"}

# Use escaped Unicode literals to keep this script ASCII-safe in any terminal.
SUSPICIOUS_MARKERS = (
    "\u951f\u65a4\u62f7",  # "???"
    "\ufffd",  # Unicode replacement character "?"
    "\u93c2\u56e8\u7051",  # mojibake form often seen in repo history
    "\u6de8\u535e\u5bb3\u4e0a\u7b00",  # common mojibake fragment
    "\u6d93\u20ac\u507b\u95c1\u6b3e",  # common mojibake fragment
    "\u95ab\u5b2d\u5ac5",  # "???"
    "\u7eee\u72b2",  # "??"
    "\u935f\u6940",  # "??"
    "\u746f\u509b",  # "??"
    "\u6942\u509b",  # "??"
    "\u5a34\u5fcf",  # "??"
    "\u7eca\u5267",  # "??"
    "\u7eca\u535e",  # "??"
    "\u95b2\u5fc0",  # "??"
)

MOJIBAKE_CHARSET = set(
    "\u93c2\u6941\u95ab\u5a34\u7eca\u7eee\u935f\u746f\u6d93\u6de8\u5f2f\u7eeb\u93cc\u9365\u5a13\u95c2"
)


def should_skip(path: Path) -> bool:
    if path.name in SKIP_FILES:
        return True
    return any(part in SKIP_DIRS for part in path.parts)


def iter_files() -> list[Path]:
    files: list[Path] = []
    for path in REPO_ROOT.rglob("*"):
        if not path.is_file():
            continue
        if should_skip(path):
            continue
        if path.suffix.lower() not in SCAN_EXTENSIONS:
            continue
        files.append(path)
    return files


def is_probable_mojibake(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False

    if any(marker in stripped for marker in SUSPICIOUS_MARKERS):
        return True

    # Heuristic: mojibake-heavy characters are usually clustered in one line.
    mojibake_hits = sum(1 for ch in stripped if ch in MOJIBAKE_CHARSET)
    return mojibake_hits >= 5 and (mojibake_hits / max(len(stripped), 1)) >= 0.18


def main() -> int:
    failures: list[tuple[Path, int, str]] = []
    for path in iter_files():
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except UnicodeDecodeError as exc:
            failures.append((path, 0, f"UTF-8 decode failed: {exc}"))
            continue

        for index, line in enumerate(lines, start=1):
            if is_probable_mojibake(line):
                failures.append((path, index, line.strip()))

    if failures:
        print("Potential encoding issues found:")
        for path, line_no, content in failures:
            rel = path.relative_to(REPO_ROOT)
            location = f"{rel}:{line_no}" if line_no else str(rel)
            safe_content = content.encode("utf-8", "backslashreplace").decode("utf-8", "ignore")
            print(f"- {location}: {safe_content}")
        return 1

    print("Encoding check passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
