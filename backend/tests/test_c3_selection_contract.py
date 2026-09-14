# -*- coding: utf-8 -*-
"""
文枢 WenShape - 深度上下文感知的智能体小说创作系统
WenShape - Deep Context-Aware Agent-Based Novel Writing System

Copyright © 2025-2026 WenShape Team
License: PolyForm Noncommercial License 1.0.0

模块说明 / Module Description:
  C3 选区输入合同测试 - 编辑器选区原文（selection_text）贯穿 chat 入口到
  Writer 的 user 消息（受预算管理、超长投影显式标注），不再只传
  has_selection 布尔值（评估报告 §6.2）。
  C3 selection-input contract tests - the editor selection text flows from
  the chat entry into the Writer user message (budget-managed, with explicit
  projection markers for oversized selections) instead of a bare
  has_selection flag (report §6.2).
"""

import asyncio

from app.orchestrator.context_assembly_service import ContextAssemblyService


class _CaptureWriterService:
    """捕获 writer_options 的 WritingService 替身（不触 LLM）。"""

    def __init__(self):
        self.calls = []

    async def run(self, project_id, chapter, message, **options):
        self.calls.append({"project_id": project_id, "chapter": chapter, "message": message, **options})
        return {"success": True, "terminal_state": "completed", "changed": False}


class _StubOwner:
    """ChatTurnService.owner 的最小替身。"""

    def __init__(self, writer_service, tmp_path):
        from app.orchestrator.orchestrator import Orchestrator

        real = Orchestrator(str(tmp_path))
        self.writing_service = writer_service
        self.select_engine = real.select_engine
        self.draft_storage = real.draft_storage
        self.session_history = real.session_history
        self.context_planning_service = real.context_planning_service
        self.memory_pack_storage = real.memory_pack_storage
        self.decide_writing_action = real.decide_writing_action
        self.application = real.application
        # owner 边界（架构契约）：注入独立的 scopes dict，不访问 real 的私有属性。
        self._active_turn_scopes = {}


def _service(tmp_path):
    from app.orchestrator.chat_turn_service import ChatTurnService

    capture = _CaptureWriterService()
    return ChatTurnService(_StubOwner(capture, tmp_path)), capture


class TestSelectionTextContract:
    """§6.2：selection_text 必须到达 Writer 的 user 消息。"""

    def test_selection_text_reaches_writer_options(self, tmp_path):
        service, capture = _service(tmp_path)
        asyncio.run(
            service.run(
                "p1",
                "V1C001",
                "把这一段改得更有张力",
                has_selection=True,
                selection_text="他握紧了手中的古镜，指尖发白。",
            )
        )
        assert capture.calls, "WritingService 未被调用"
        options = capture.calls[0]
        assert options.get("selection_text") == "他握紧了手中的古镜，指尖发白。"

    def test_selection_block_in_writer_user_message(self, tmp_path):
        """选区原文进入 user 消息（经 _build_writer_user，预算管理内）。"""
        assembler = ContextAssemblyService()
        request = assembler.assemble_writer_request(
            message="润色选中段落",
            chapter="V1C001",
            current_text="正文上下文。",
            has_selection=True,
            target_word_count=1000,
            selection_text="唯一的选区原文SELECTION_SENTINEL。",
        )
        user_message = next(m["content"] for m in request.messages if m["role"] == "user")
        assert "SELECTION_SENTINEL" in user_message, "选区原文必须进入 user 消息（C3）"
        assert "选区" in user_message or "选中" in user_message

    def test_oversized_selection_projects_explicitly(self, tmp_path):
        """超长选区按预算投影并显式标注，不静默截断。"""
        assembler = ContextAssemblyService()
        request = assembler.assemble_writer_request(
            message="改写选区",
            chapter="V1C001",
            current_text="正文。",
            has_selection=True,
            target_word_count=1000,
            selection_text="选区正文。" * 4000,
        )
        user_message = next(m["content"] for m in request.messages if m["role"] == "user")
        assert "截断" in user_message, "超长选区必须显式标注投影（不静默丢尾）"

    def test_selection_absent_keeps_hint_only(self, tmp_path):
        """无选区文本时退化为既有提示（has_selection 布尔语义保留）。"""
        assembler = ContextAssemblyService()
        request = assembler.assemble_writer_request(
            message="继续写",
            chapter="V1C001",
            current_text="正文。",
            has_selection=True,
            target_word_count=1000,
        )
        user_message = next(m["content"] for m in request.messages if m["role"] == "user")
        assert "选中" in user_message and "read_chapter" in user_message

    def test_no_selection_untouched(self, tmp_path):
        """无选区（布尔也为假）时 user 消息不含选区块——不破坏既有路径。"""
        assembler = ContextAssemblyService()
        request = assembler.assemble_writer_request(
            message="继续写",
            chapter="V1C001",
            current_text="正文。",
            has_selection=False,
            target_word_count=1000,
        )
        user_message = next(m["content"] for m in request.messages if m["role"] == "user")
        assert "选区" not in user_message and "选中" not in user_message
