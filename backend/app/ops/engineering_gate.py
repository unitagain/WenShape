"""Single owner for engineering checks shared by CI and the release gate."""

from __future__ import annotations

from pathlib import Path
from typing import List, Tuple

EngineeringCheck = Tuple[str, List[str], Path]


def engineering_checks(repo_root: Path) -> list[EngineeringCheck]:
    repo = Path(repo_root).resolve()
    backend = repo / "backend"
    return [
        # evaluation/ 是诊断资产（V3），不属于生产运行时；仍须 lint，但与 app/ 的生产基线区分开。
        ("ruff", ["python", "-m", "ruff", "check", "app", "evaluation", "tests", "scripts"], backend),
        ("type_contract", ["python", "scripts/type_contract_check.py"], backend),
        ("pytest", ["python", "-m", "pytest"], backend),
        ("pip_check", ["python", "-m", "pip", "check"], backend),
        ("error_contract", ["python", "scripts/error_contract_audit.py"], backend),
        ("architecture", ["python", "scripts/architecture_profile.py", "--check"], backend),
        ("requirements_sync", ["python", "scripts/check_requirements_sync.py"], repo),
    ]
