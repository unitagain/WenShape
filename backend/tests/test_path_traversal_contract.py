# -*- coding: utf-8 -*-
"""
文枢 WenShape - 深度上下文感知的智能体小说创作系统
WenShape - Deep Context-Aware Agent-Based Novel Writing System

Copyright © 2025-2026 WenShape Team
License: PolyForm Noncommercial License 1.0.0

模块说明 / Module Description:
  V1-1 路径遍历合同测试 - 冻结「存储层单点拒绝式校验」这一安全不变量。
  V1-1 path traversal contract tests - freeze the single-point, reject-only storage guard.

为什么合同测试放在存储层而不是逐个路由：
  ``BaseStorage.get_project_path`` 是全部 20 个路由构造项目目录的唯一收敛点，
  在此校验即覆盖全部读写端点；逐路由校验会漏，且新增路由会再次引入同类缺口。

Why these are contract (not unit) tests:
  The guard must reject, never rewrite. Rewriting an escaping id into a valid one
  silently redirects reads/writes to a different project — harder to notice than an error.
"""

import asyncio
import logging

import pytest

from app.error_contract import ErrorCategory, classify_exception, status_code_for
from app.storage.base import BaseStorage
from app.utils.path_safety import UnsafeIdentifierError, sanitize_id, validate_identifier

# 攻击载荷：每条都必须被拒绝，且不得被改写为其他合法标识符。
# Attack payloads: each must be rejected outright, never rewritten.
TRAVERSAL_IDS = [
    "../../../Windows/Temp",
    "..\\..\\secret",
    "../data/gracepalace",
    "..",
    "a/../../b",
    "foo/bar",
    "foo\\bar",
    "/etc/passwd",
    "C:\\Windows",
    "a:b",  # NTFS 备用数据流 / NTFS alternate data stream
]

# 既有真实项目 ID：收紧校验后必须全部仍然可用（含中文）。
# Real-world existing ids: all must keep working after the guard is tightened.
LEGACY_IDS = [
    "gracepalace",
    "w8-runtime-a",
    "p",
    "w",
    "_system",
    "我的第一个项目",
    "proj_2026-08",
    "uuid-4f3a2b1c",
]


class TestGetProjectPathRejectsTraversal:
    """存储层单点校验：遍历输入抛异常，不改写、不落到其他目录。"""

    @pytest.mark.parametrize("project_id", TRAVERSAL_IDS)
    def test_traversal_raises(self, project_id):
        storage = BaseStorage()
        with pytest.raises(UnsafeIdentifierError):
            storage.get_project_path(project_id)

    @pytest.mark.parametrize("project_id", LEGACY_IDS)
    def test_existing_ids_still_allowed(self, project_id):
        """收紧校验不得误伤存量项目，中文项目名必须仍可用。"""
        storage = BaseStorage()
        path = storage.get_project_path(project_id)
        # 原样使用，未被改写 / used verbatim, not rewritten
        assert path.name == project_id
        assert path.parent == storage.data_dir

    def test_empty_and_non_str_rejected(self):
        storage = BaseStorage()
        for bad in ["", None, 123]:
            with pytest.raises(UnsafeIdentifierError):
                storage.get_project_path(bad)

    def test_rejection_never_rewrites_into_another_project(self):
        """
        本条是 V1-1 的核心不变量。

        ``sanitize_id`` 会把 ``../../gracepalace`` 改写成 ``gracepalace`` —— 若用它做
        校验，越界请求会静默命中另一个合法项目。校验路径必须拒绝，而不是改写。
        """
        escaping = "../../gracepalace"
        # sanitize_id 的改写行为（这正是不能拿它做校验的原因）
        assert sanitize_id(escaping) == "gracepalace"
        # 校验路径必须拒绝
        with pytest.raises(UnsafeIdentifierError):
            validate_identifier(escaping, field="project_id")
        with pytest.raises(UnsafeIdentifierError):
            BaseStorage().get_project_path(escaping)


class TestUnsafeIdentifierErrorContract:
    """错误合同：复用既有 DomainError 通道，映射 400，且不泄露真实路径。"""

    def test_maps_to_400_validation(self):
        exc = UnsafeIdentifierError("unsafe_project_id:traversal", code="unsafe_project_id")
        assert classify_exception(exc) is exc
        assert exc.category is ErrorCategory.VALIDATION
        assert status_code_for(exc) == 400

    def test_public_detail_hides_filesystem_path(self):
        storage = BaseStorage()
        try:
            storage.get_project_path("../../../Windows/Temp")
        except UnsafeIdentifierError as exc:
            payload = str(exc.safe_detail) + str(exc.code)
            assert "Windows" not in payload
            assert "data" not in payload.lower().replace("validation", "")
        else:  # pragma: no cover - guard must raise
            pytest.fail("traversal id was not rejected")

    def test_remains_valueerror_for_legacy_callers(self):
        """既有 ``except ValueError`` 调用点（routers/projects.py 等）行为不变。"""
        assert issubclass(UnsafeIdentifierError, ValueError)


class TestWriteEndpointsShareTheSameGuard:
    """写入端点与读取端点共享同一收敛点，单点修复一并覆盖。"""

    def test_write_path_helpers_are_guarded(self):
        storage = BaseStorage()
        # 任何以 project_id 构造路径的存储操作都必须先过校验
        with pytest.raises(UnsafeIdentifierError):
            storage.get_project_path("../../../evil") / "cards"


class TestHttpLayerRejectsTraversal:
    """
    端到端：手工构造 ASGI scope 直连 app，绕过客户端 URL 规范化。

    ``%2F`` 会被解码为 ``/`` 并作为单个路径参数传入，路由仍正常匹配 ——
    这正是该漏洞此前可被利用的方式。
    """

    @staticmethod
    def _call(path: str) -> dict:
        from app.main import app

        out: dict = {}

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            if message["type"] == "http.response.start":
                out["status"] = message["status"]
            elif message["type"] == "http.response.body":
                out["body"] = out.get("body", b"") + message.get("body", b"")

        scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "query_string": b"",
            "root_path": "",
            "headers": [(b"host", b"127.0.0.1")],
            "client": ("127.0.0.1", 1),
            "server": ("127.0.0.1", 8000),
        }
        asyncio.run(app(scope, receive, send))
        return out

    @pytest.mark.parametrize(
        "path",
        [
            "/api/projects/..%2Fdata%2Fgracepalace/volumes",
            "/api/projects/..%2F..%2FWenShape-main%2Fdata%2Fgracepalace/volumes",
            "/api/projects/..%2F..%2F..%2FWindows%2FTemp/volumes",
        ],
    )
    def test_traversal_returns_400_without_leaking_path(self, path, caplog):
        with caplog.at_level(logging.CRITICAL):
            result = self._call(path)
        assert result.get("status") == 400
        body = result.get("body", b"").decode("utf-8", "replace")
        assert "unsafe_project_id" in body
        # 响应体不得包含真实文件系统路径
        assert "Github-WenShape" not in body
        assert "C:\\" not in body
