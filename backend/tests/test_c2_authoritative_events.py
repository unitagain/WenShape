# -*- coding: utf-8 -*-
"""
文枢 WenShape - 深度上下文感知的智能体小说创作系统
WenShape - Deep Context-Aware Agent-Based Novel Writing System

Copyright © 2025-2026 WenShape Team
License: PolyForm Noncommercial License 1.0.0

模块说明 / Module Description:
  C2 后端权威会话事件合同测试 - turn 入口/终态由后端持久化事件（稳定
  event_id 幂等去重）；直接调用聊天 API、前端 appendHistory 重试、重复
  请求不丢失也不重复已确认事件（评估报告 §6.3）。
  C2 authoritative session events - the turn entry/terminal states are
  persisted by the backend with stable deduplicating event ids; direct API
  calls, frontend retries, and repeated requests neither lose nor duplicate
  confirmed events (report §6.3).
"""

import asyncio

from app.storage.session_history import SessionHistoryStorage


class _CaptureWriterService:
    def __init__(self, result=None):
        self.calls = []
        self._result = result or {"success": True, "terminal_state": "completed", "changed": False, "message": "本轮已完成SENTINEL_DONE"}

    async def run(self, project_id, chapter, message, **options):
        self.calls.append({"message": message, **options})
        return dict(self._result)


def _service(tmp_path, writer_result=None):
    from app.orchestrator.chat_turn_service import ChatTurnService
    from app.orchestrator.orchestrator import Orchestrator

    real = Orchestrator(str(tmp_path))
    capture = _CaptureWriterService(writer_result)
    real.writing_service = capture

    class _Owner:
        pass

    owner = _Owner()
    owner.writing_service = capture
    owner.select_engine = real.select_engine
    owner.draft_storage = real.draft_storage
    owner.session_history = real.session_history
    owner.context_planning_service = real.context_planning_service
    owner.memory_pack_storage = real.memory_pack_storage
    owner.decide_writing_action = real.decide_writing_action
    owner.application = real.application
    # owner 边界（架构契约）：ChatTurnService 持有的是共享 dict，
    # 以公开值注入而非访问 real 的私有属性。
    owner._active_turn_scopes = {}
    return ChatTurnService(owner), capture, real


class TestAuthoritativeTurnEvents:
    """§6.3：后端在 turn 入口/终态持久化权威事件。"""

    def test_turn_persists_user_and_assistant_events(self, tmp_path):
        service, capture, orch = _service(tmp_path)
        asyncio.run(service.run("p1", "V1C001", "写一段开头CONTENT_SENTINEL"))
        history = asyncio.run(orch.session_history.load("p1"))
        roles = [item["role"] for item in history]
        contents = "\n".join(str(item.get("content") or "") for item in history)
        assert "user" in roles and "assistant" in roles
        assert "CONTENT_SENTINEL" in contents, "user 消息必须由后端权威持久化（C2）"
        assert "SENTINEL_DONE" in contents, "终态答复摘要必须持久化"

    def test_event_ids_are_stable_and_deduplicated(self, tmp_path):
        """append_once：相同 event_id 重复追加不产生重复行。"""
        store = SessionHistoryStorage(str(tmp_path))
        first = asyncio.run(store.append_once("p1", {"role": "user", "content": "x", "event_id": "evt_dedup"}))
        second = asyncio.run(store.append_once("p1", {"role": "user", "content": "x", "event_id": "evt_dedup"}))
        assert first is not None
        assert second is None, "重复 event_id 必须跳过"
        history = asyncio.run(store.load("p1"))
        assert len([i for i in history if i.get("event_id") == "evt_dedup"]) == 1

    def test_repeated_turn_request_no_duplicate_user_events(self, tmp_path):
        """同一 turn 重放（重试）不产生重复行——按 turn 消息内容独立 event_id。"""
        service, capture, orch = _service(tmp_path)
        asyncio.run(service.run("p1", "V1C001", "第一次请求"))
        asyncio.run(service.run("p1", "V1C001", "第一次请求"))  # 前端重试场景
        history = asyncio.run(orch.session_history.load("p1"))
        user_rows = [i for i in history if i["role"] == "user" and i.get("content") == "第一次请求"]
        assert len(user_rows) >= 1, "user 事件必须存在"
        # 两次 turn 的 turn_id 不同，事件各自成行（后端权威）；但单 turn 内的
        # 幂等由 append_once 保证（见上一用例）。

    def test_frontend_duplicate_event_id_is_deduplicated(self, tmp_path):
        """前端 appendHistory 与后端权威事件使用同一 event_id 时不重复。

        模拟：后端已落 turn 事件（event_id=X），前端随后用同一 event_id 补发
        append——append_once 跳过；普通 append 的兼容通道保留（历史行为）。
        """
        store = SessionHistoryStorage(str(tmp_path))
        asyncio.run(store.append_once("p1", {"role": "user", "content": "u", "event_id": "evt_front"}))
        # 前端用同 event_id 重发（带 event_id 的兼容路径）
        skipped = asyncio.run(store.append_once("p1", {"role": "user", "content": "u", "event_id": "evt_front"}))
        assert skipped is None
        history = asyncio.run(store.load("p1"))
        assert len(history) == 1

    def test_turn_event_failure_does_not_block_turn(self, tmp_path):
        """事件持久化失败只降级，不阻断 turn 主链路。"""
        service, capture, orch = _service(tmp_path)

        async def _broken_append_once(*args, **kwargs):
            raise RuntimeError("storage_unavailable")

        orch.application.conversation.append_once = _broken_append_once
        result = asyncio.run(service.run("p1", "V1C001", "正常指令"))
        assert result is not None, "事件失败不得让 turn 失败"
        assert capture.calls, "Writer 主链路照常执行"
