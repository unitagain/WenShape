#!/usr/bin/env python3
"""Produce a reproducible call, dependency and public-contract architecture profile."""

from __future__ import annotations

import argparse
import ast
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


BACKEND_ROOT = Path(__file__).resolve().parents[1]
ORCHESTRATOR_PATH = BACKEND_ROOT / "app" / "orchestrator" / "orchestrator.py"
APP_ROOT = BACKEND_ROOT / "app"


def _orchestrator_methods() -> dict[str, ast.FunctionDef | ast.AsyncFunctionDef]:
    tree = ast.parse(ORCHESTRATOR_PATH.read_text(encoding="utf-8-sig"), filename=str(ORCHESTRATOR_PATH))
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == "Orchestrator":
            return {
                child.name: child
                for child in node.body
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef))
            }
    raise RuntimeError("Orchestrator class not found")


def _delegation_target(node: ast.FunctionDef | ast.AsyncFunctionDef) -> str:
    body = list(node.body)
    if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
        body = body[1:]
    if len(body) != 1 or not isinstance(body[0], ast.Return):
        return ""
    value = body[0].value
    if isinstance(value, ast.Await):
        value = value.value
    if not isinstance(value, ast.Call) or not isinstance(value.func, ast.Attribute):
        return ""
    parts = []
    cursor: ast.expr = value.func
    while isinstance(cursor, ast.Attribute):
        parts.append(cursor.attr)
        cursor = cursor.value
    if not isinstance(cursor, ast.Name) or cursor.id != "self":
        return ""
    return "self." + ".".join(reversed(parts))


def _module_name(path: Path) -> str:
    relative = path.relative_to(BACKEND_ROOT).with_suffix("")
    parts = list(relative.parts)
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts)


def _imports(tree: ast.AST, *, package_parts: list[str] | None = None) -> set[str]:
    """Collect imported app.* modules (absolute and package-relative).

    Relative imports (``from .writer import WriterAgent`` inside ``app/agents/__init__.py``)
    must resolve against the importer's package, or every package-``__init__`` re-export
    chain looks disconnected and live modules get flagged as unreachable.
    *package_parts* is the importer's package path (``["app", "agents"]`` for both
    ``app/agents/__init__.py`` and ``app/agents/base.py``); None keeps only absolute imports
    (used for external consumers under tests/scripts/evaluation).
    """

    result: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            result.update(alias.name for alias in node.names if alias.name.startswith("app."))
        elif isinstance(node, ast.ImportFrom):
            if node.module and node.module.startswith("app.") and not node.level:
                result.add(node.module)
            elif node.level and package_parts is not None:
                # level=1 → 当前包；level=2 → 上一级包……基点取导入者的包路径。
                climb = min(node.level - 1, len(package_parts))
                base_parts = package_parts[: len(package_parts) - climb]
                if node.module:
                    resolved = ".".join([*base_parts, node.module])
                else:
                    resolved = ".".join(base_parts)
                if resolved.startswith("app."):
                    result.add(resolved)
    return result


def _dependency_graph() -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    graph: dict[str, set[str]] = defaultdict(set)
    importers: dict[str, set[str]] = defaultdict(set)
    modules = {_module_name(path) for path in APP_ROOT.rglob("*.py")}
    for path in APP_ROOT.rglob("*.py"):
        module = _module_name(path)
        try:
            tree = ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))
        except (OSError, SyntaxError, UnicodeError):
            continue
        # 相对导入的解析基点：包模块（__init__.py）的包是自身，普通模块的包是父级。
        module_parts = module.split(".")
        package_parts = module_parts if path.name == "__init__.py" else module_parts[:-1]
        for imported in _imports(tree, package_parts=package_parts):
            target = imported
            while target and target not in modules:
                target = target.rpartition(".")[0]
            if not target or target == module:
                continue
            graph[module].add(target)
            importers[target].add(module)
        graph.setdefault(module, set())
    return graph, importers


def _external_import_roots() -> set[str]:
    """app.* modules imported from outside app/ (tests, scripts, evaluation).

    The dependency graph spans app/ only, so a module used exclusively by an
    external consumer would look dead to a pure app-internal reachability walk.
    The project's dead-code criterion (U10-C2) counts references across
    tests/scripts/evaluation too, so those imports become roots here.
    """

    roots: set[str] = set()
    modules: set[str] = set()
    for path in APP_ROOT.rglob("*.py"):
        modules.add(_module_name(path))
        parent = _module_name(path)
        while "." in parent:
            parent = parent.rpartition(".")[0]
            modules.add(parent)
    for directory in ("tests", "scripts", "evaluation"):
        root = BACKEND_ROOT / directory
        if not root.exists():
            continue
        for path in root.rglob("*.py"):
            try:
                tree = ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))
            except (OSError, SyntaxError, UnicodeError):
                continue
            for imported in _imports(tree):
                target = imported
                while target and target not in modules:
                    target = target.rpartition(".")[0]
                if target:
                    roots.add(target)
    return roots


def _unreachable_modules(graph: dict[str, set[str]]) -> list[str]:
    """Modules no runtime or tooling entry can import (dead-module candidates).

    Roots are every importable entry the host actually loads: the FastAPI app,
    each router module (registered dynamically), dependencies, plus every app.*
    module imported by tests/scripts/evaluation. Reference counting can only
    find dead *leaves* — a dead *subgraph* whose members import each other looks
    alive to it (this is exactly how working_memory_service survived the U10-C2
    sweep). Reachability from real entry points closes that gap.

    Note: package ``__init__`` modules are excluded from the dead list — a
    package is "reached" whenever any submodule is imported, and star-import
    chains (app.prompts -> app.prompt_templates.*) are already edges in the
    graph because ``ast.ImportFrom`` records the parent module.
    """

    roots = {"app.main", "app.dependencies", "app.routers"}
    roots.update(name for name in graph if name.startswith("app.routers."))
    roots.update(_external_import_roots())
    seen: set[str] = set()
    stack = [name for name in roots if name in graph]
    while stack:
        module = stack.pop()
        if module in seen:
            continue
        seen.add(module)
        stack.extend(graph.get(module, ()))
    # 祖先闭包放在 BFS 之后：import 子模块隐式导入父包，父包因此可达。
    # 不能在遍历中提前把父包标为 seen——那会跳过父包 __init__ 自己的
    # re-export 出边（providers.__init__ → 6 个 provider），活模块会被误判为死。
    reachable = set(seen)
    for module in seen:
        parent = module.rpartition(".")[0]
        while parent and parent != "app":
            reachable.add(parent)
            parent = parent.rpartition(".")[0]
    return sorted(name for name in graph if name not in reachable and not name.endswith(".__init__") and name != "app")


def _cycles(graph: dict[str, set[str]]) -> list[list[str]]:
    index = 0
    stack: list[str] = []
    on_stack: set[str] = set()
    indexes: dict[str, int] = {}
    lowlinks: dict[str, int] = {}
    result: list[list[str]] = []

    def visit(node: str) -> None:
        nonlocal index
        indexes[node] = index
        lowlinks[node] = index
        index += 1
        stack.append(node)
        on_stack.add(node)
        for target in graph.get(node, set()):
            if target not in indexes:
                visit(target)
                lowlinks[node] = min(lowlinks[node], lowlinks[target])
            elif target in on_stack:
                lowlinks[node] = min(lowlinks[node], indexes[target])
        if lowlinks[node] != indexes[node]:
            return
        component = []
        while stack:
            member = stack.pop()
            on_stack.remove(member)
            component.append(member)
            if member == node:
                break
        if len(component) > 1:
            result.append(sorted(component))

    for node in sorted(graph):
        if node not in indexes:
            visit(node)
    return sorted(result)


def _external_private_accesses(roots: list[Path] | None = None) -> list[str]:
    violations: list[str] = []
    # evaluation/ 自 V3 起独立于 app/：它仍受本检查约束（其 longform_pipeline 有 owner port 规则），
    # 故必须显式列入扫描根——否则移出 app/ 会让既有规则静默失效。
    roots = roots or [BACKEND_ROOT / name for name in ("app/routers", "app/jobs", "evaluation", "scripts", "tests")]
    private_modules = ("app.orchestrator._", "app.llm_gateway._", "evaluation._")
    owner_types = {"Orchestrator", "LLMGateway"}
    for root in roots:
        if not root.exists():
            continue
        for path in root.rglob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))
            try:
                relative = path.relative_to(BACKEND_ROOT).as_posix()
            except ValueError:
                relative = path.name
            constructors: set[str] = set(owner_types)
            owners = {"orchestrator", "orch", "gateway", "harness"}
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        if alias.name.startswith(private_modules):
                            violations.append(f"{relative}:{node.lineno}:private_module:{alias.name}")
                elif isinstance(node, ast.ImportFrom):
                    if node.module and node.module.startswith(private_modules):
                        violations.append(f"{relative}:{node.lineno}:private_module:{node.module}")
                    for alias in node.names:
                        if alias.name in owner_types:
                            constructors.add(alias.asname or alias.name)
            changed = True
            while changed:
                changed = False
                for node in ast.walk(tree):
                    if not isinstance(node, (ast.Assign, ast.AnnAssign)):
                        continue
                    value = node.value
                    targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                    owned = isinstance(value, ast.Name) and value.id in owners
                    owned = owned or (
                        isinstance(value, ast.Call) and isinstance(value.func, ast.Name) and value.func.id in constructors
                    )
                    owned = owned or (
                        isinstance(value, ast.Attribute) and value.attr in {"orchestrator", "gateway", "harness"}
                    )
                    if owned:
                        for target in targets:
                            if isinstance(target, ast.Name) and target.id not in owners:
                                owners.add(target.id)
                                changed = True
            for node in ast.walk(tree):
                if (
                    isinstance(node, ast.Attribute)
                    and node.attr.startswith("_")
                    and isinstance(node.value, ast.Name)
                    and node.value.id in owners
                ):
                    violations.append(f"{relative}:{node.lineno}:private_attribute:{node.value.id}.{node.attr}")
                if (
                    isinstance(node, ast.Attribute)
                    and node.attr.startswith("_")
                    and relative == "evaluation/longform_pipeline.py"
                    and isinstance(node.value, ast.Attribute)
                    and node.value.attr == "backend"
                ):
                    violations.append(f"{relative}:{node.lineno}:private_owner_port:backend.{node.attr}")
    return sorted(set(violations))


def build_profile() -> dict[str, Any]:
    methods = _orchestrator_methods()
    references: Counter[str] = Counter()
    files: dict[str, set[str]] = {name: set() for name in methods}
    for path in BACKEND_ROOT.rglob("*.py"):
        if any(part in {".venv", "__pycache__"} for part in path.parts):
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))
        except (OSError, SyntaxError, UnicodeError):
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.Attribute):
                continue
            name = node.attr
            if name not in methods or name == "__init__":
                continue
            references[name] += 1
            files[name].add(path.relative_to(BACKEND_ROOT).as_posix())

    rows = []
    for name, node in sorted(methods.items(), key=lambda item: item[1].lineno):
        target = _delegation_target(node)
        rows.append(
            {
                "method": name,
                "line": node.lineno,
                "references": references[name],
                "reference_files": sorted(files[name]),
                "delegation_target": target,
                "facade_candidate": bool(target),
                "unreferenced_candidate": references[name] == 0 and name != "__init__",
            }
        )
    return {
        "schema_version": 4,
        "backend_root": str(BACKEND_ROOT),
        "orchestrator": str(ORCHESTRATOR_PATH.relative_to(BACKEND_ROOT)),
        "method_count": len(rows),
        "facade_candidates": sum(row["facade_candidate"] for row in rows),
        "unreferenced_candidates": sum(row["unreferenced_candidate"] for row in rows),
        "public_method_count": sum(not row["method"].startswith("_") for row in rows),
        "methods": rows,
    }


def build_architecture_profile() -> dict[str, Any]:
    profile = build_profile()
    graph, importers = _dependency_graph()
    cycles = _cycles(graph)
    unreachable = _unreachable_modules(graph)
    profile.update(
        {
            "module_count": len(graph),
            "dependency_edges": sum(len(targets) for targets in graph.values()),
            "dependency_cycles": cycles,
            "dependency_cycle_count": len(cycles),
            "unreachable_modules": unreachable,
            "unreachable_module_count": len(unreachable),
            "external_private_accesses": _external_private_accesses(),
            "change_fanout": [
                {"module": module, "importers": len(sources), "importer_modules": sorted(sources)}
                for module, sources in sorted(importers.items(), key=lambda item: (-len(item[1]), item[0]))[:20]
            ],
        }
    )
    return profile


def architecture_violations(profile: dict[str, Any]) -> list[str]:
    """Return release-blocking architecture contract violations."""
    violations: list[str] = []
    cycles = profile.get("dependency_cycles") or []
    private_accesses = profile.get("external_private_accesses") or []
    unreachable = profile.get("unreachable_modules") or []
    if cycles:
        violations.append(f"dependency_cycles:{len(cycles)}")
    if private_accesses:
        violations.append(f"external_private_accesses:{len(private_accesses)}")
    if unreachable:
        violations.append(f"unreachable_modules:{len(unreachable)}:{','.join(unreachable[:8])}")
    return violations


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="Optional JSON output path")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit non-zero when dependency cycles or external private accesses are found",
    )
    args = parser.parse_args()
    profile = build_architecture_profile()
    profile["violations"] = architecture_violations(profile)
    payload = json.dumps(profile, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload + "\n", encoding="utf-8")
    print(payload)
    return 1 if args.check and profile["violations"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
