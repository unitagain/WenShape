#!/usr/bin/env python3
"""Enforce bilingual module docstrings for backend/app Python files."""

from __future__ import annotations

import ast
import re
import sys
import warnings
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_APP = REPO_ROOT / "backend" / "app"


def has_chinese(text: str) -> bool:
    return bool(re.search(r"[一-鿿]", text or ""))


def has_english(text: str) -> bool:
    return bool(re.search(r"[A-Za-z]{3,}", text or ""))


def module_docstring(path: Path) -> str | None:
    source = path.read_text(encoding="utf-8-sig")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", SyntaxWarning)
        tree = ast.parse(source)
    if not tree.body:
        return None
    first = tree.body[0]
    if not isinstance(first, ast.Expr):
        return None
    value = getattr(first, "value", None)
    if not isinstance(value, ast.Constant) or not isinstance(value.value, str):
        return None
    return value.value


def main() -> int:
    violations: list[str] = []
    for path in sorted(BACKEND_APP.rglob("*.py")):
        rel = path.relative_to(REPO_ROOT).as_posix()
        try:
            doc = module_docstring(path)
        except SyntaxError as exc:
            violations.append(f"{rel}: syntax error while parsing ({exc})")
            continue

        if not doc:
            violations.append(f"{rel}: missing module docstring")
            continue
        if not has_chinese(doc):
            violations.append(f"{rel}: module docstring missing Chinese description")
        if not has_english(doc):
            violations.append(f"{rel}: module docstring missing English description")

    if violations:
        print("Bilingual docstring check failed:")
        for item in violations:
            print(f"- {item}")
        return 1

    print("Bilingual docstring check passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
