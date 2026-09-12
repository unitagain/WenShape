# -*- coding: utf-8 -*-
"""
文枢 WenShape - 深度上下文感知的智能体小说创作系统
WenShape - Deep Context-Aware Agent-Based Novel Writing System

Copyright © 2025-2026 WenShape Team
License: PolyForm Noncommercial License 1.0.0

模块说明 / Module Description:
  A2 固定会话身份合同测试 - 压缩链路（compact → job → HTTP）的会话身份
  在入口解析一次并贯穿到底，await 边界期间活动会话切换不再串写（评估报告 F05）。
  A2 conversation identity contract tests - the compact pipeline resolves the
  conversation id once at entry and threads it through; switching the active
  conversation across await boundaries must not redirect artifacts (finding F05).

反例设计：在摘要生成、语义校验、最终写回三个 await 屏障内切换 A/B 会话，
压缩的投影、artifact、state、恢复必须仍归属原会话 A。
"""

import asyncio

import pytest

from app.storage.session_history import SessionHistoryStorage


def _store(tmp_path) -> SessionHistoryStorage:
    return SessionHistoryStorage(str(tmp_path))


def _seed_conversation(store: SessionHistoryStorage, project_id: str, cid: str, turns: int) -> str:
    """创建会话并灌入足够触发压缩的对话；返回会话 id。"""
    if cid != "legacy":
        created = asyncio.run(store.create_conversation(project_id, title=f"会话{cid}"))
        cid = created["id"]
    for i in range(turns):
        asyncio.run(
            store.append(project_id, {"role": "user", "content": f"{cid}-用户消息{i}-SENTINEL_A2"}, conversation_id=cid)
        )
        asyncio.run(
            store.append(project_id, {"role": "assistant", "content": f"{cid}-回复{i}"}, conversation_id=cid)
        )
    return cid


def _make_two_conversations(tmp_path, turns: int = 40):
    """构建 A/B 两会话并激活 A；返回 (store, cid_a, cid_b)。"""
    store = _store(tmp_path)
    cid_a = _seed_conversation(store, "p1", "conv_a", turns)
    cid_b = _seed_conversation(store, "p1", "conv_b", turns)
    asyncio.run(store.activate_conversation("p1", cid_a))
    return store, cid_a, cid_b


def _summarizer_with_switch(store, project_id, switch_to, *, phase: str):
    """返回一个摘要函数：调用时（可选拦截点）把活动会话切到 B——F05 复现时序。"""

    async def summarizer(old_messages):
        if phase == "summarizer":
            await store.activate_conversation(project_id, switch_to)
        return "A 会话摘要：早期轮次已完成压缩测试。"

    return summarizer


def _verifier_with_switch(store, project_id, switch_to, *, phase: str):
    async def verifier(artifact, source_messages):
        if phase == "verifier":
            await store.activate_conversation(project_id, switch_to)
        return {"valid": True}

    return verifier


class TestCompactIdentityAcrossAwaitBarriers:
    """F05 核心反例：三个 await 屏障内切换活动会话，压缩产物仍归属原会话。"""

    @pytest.mark.parametrize("phase", ["summarizer", "verifier", "commit"])
    def test_switching_active_mid_compact_keeps_artifact_in_origin(self, tmp_path, phase):
        store, cid_a, cid_b = _make_two_conversations(tmp_path)
        switch_to = cid_b

        # commit 屏障：在语义校验通过后、写回前的最后一个 await 前切换
        original_verifier = _verifier_with_switch(store, "p1", switch_to, phase=phase)

        async def verifier(artifact, source_messages):
            result = await original_verifier(artifact, source_messages)
            if phase == "commit":
                await store.activate_conversation("p1", switch_to)
            return result

        summarizer = _summarizer_with_switch(store, "p1", switch_to, phase=phase)
        result = asyncio.run(
            store.compact(
                "p1",
                summarizer,
                conversation_id=cid_a,
                keep_recent=10,
                trigger_at=20,
                semantic_verifier=verifier,
            )
        )
        assert result["compacted"] is True, result
        assert result["conversation_id"] == cid_a

        # 1. A 的投影出现摘要
        projection = asyncio.run(store.load("p1", conversation_id=cid_a))
        assert any(item.get("type") == "summary" for item in projection)

        # 2. A 的 artifact 落在 A 的目录（不再串写到 B）
        artifact_id = result["compact_artifact_id"]
        assert (
            asyncio.run(store.read_compact_artifact("p1", artifact_id, conversation_id=cid_a)) is not None
        ), "A 的 artifact 必须存在于 A 会话目录"
        assert (
            asyncio.run(store.read_compact_artifact("p1", artifact_id, conversation_id=cid_b)) is None
        ), "A 的 artifact 不得写入 B 会话目录"

        # 3. B 无法用 A 的 artifact 恢复源事件；A 自己可以恢复
        recovered_in_b = asyncio.run(store.recover_compact_sources("p1", artifact_id, conversation_id=cid_b))
        assert recovered_in_b == []
        recovered_in_a = asyncio.run(store.recover_compact_sources("p1", artifact_id, conversation_id=cid_a))
        assert recovered_in_a, "A 必须能恢复自己的源事件"
        assert any("SENTINEL_A2" in str(item.get("content") or "") for item in recovered_in_a)

        # 4. epoch 归属：A 的 state 推进，B 的 state 不受影响
        assert asyncio.run(store.current_context_epoch("p1", conversation_id=cid_a)) >= 1
        assert asyncio.run(store.current_context_epoch("p1", conversation_id=cid_b)) == 0

    def test_concurrent_append_to_origin_during_compact_is_preserved(self, tmp_path):
        """压缩期间对原会话的并发追加必须保留（会话切换不掩盖 append）。"""
        store, cid_a, cid_b = _make_two_conversations(tmp_path)

        async def summarizer(old_messages):
            # 模拟摘要生成期间：对 A 追加新消息 + 切换 active 到 B
            await store.append("p1", {"role": "user", "content": "并发追加SENTINEL_APPEND"}, conversation_id=cid_a)
            await store.activate_conversation("p1", cid_b)
            return "A 会话摘要。"

        result = asyncio.run(
            store.compact("p1", summarizer, conversation_id=cid_a, keep_recent=10, trigger_at=20)
        )
        assert result["compacted"] is True, result
        assert result.get("preserved_concurrent_appends", 0) >= 1
        projection = asyncio.run(store.load("p1", conversation_id=cid_a))
        assert any("SENTINEL_APPEND" in str(item.get("content") or "") for item in projection)


class TestCompactJobIdentity:
    """任务 payload 与幂等 key 的会话身份。"""

    def test_enqueue_carries_conversation_id_and_distinct_keys(self, tmp_path, monkeypatch):
        from app.jobs import runtime as jobs_runtime
        from app.jobs.durable_queue import DurableTaskQueue

        queue = DurableTaskQueue(tmp_path / "_system" / "task_queue")
        monkeypatch.setattr(jobs_runtime, "get_task_queue", lambda: queue)

        job_a = asyncio.run(jobs_runtime.enqueue_session_compact("p1", history_count=121, conversation_id="conv_a"))
        job_b = asyncio.run(jobs_runtime.enqueue_session_compact("p1", history_count=121, conversation_id="conv_b"))
        assert job_a["id"] != job_b["id"]

        # legacy（空 cid）与显式 cid 也不共用幂等 key
        job_legacy = asyncio.run(jobs_runtime.enqueue_session_compact("p1", history_count=121))
        assert job_legacy["id"] != job_a["id"]

        # 相同 (project, cid, count) 重复入队幂等（同一 job）
        job_a2 = asyncio.run(jobs_runtime.enqueue_session_compact("p1", history_count=121, conversation_id="conv_a"))
        assert job_a2["id"] == job_a["id"]

        # payload 携带 cid，worker 不需要再解析 active（_all 为既有故障注入测试保留的兼容方法）
        pending = queue._all()
        payload_by_id = {job["id"]: job.get("payload") or {} for job in pending}
        assert payload_by_id[job_a["id"]].get("conversation_id") == "conv_a"
        assert payload_by_id[job_legacy["id"]].get("conversation_id") == ""


class TestLegacyConversationCompat:
    """legacy 会话（无 cid 目录）压缩行为不变。"""

    def test_legacy_compact_still_works_and_reports_legacy(self, tmp_path):
        store = _store(tmp_path)
        _seed_conversation(store, "p1", "legacy", 40)

        async def summarizer(old_messages):
            return "legacy 摘要。"

        result = asyncio.run(store.compact("p1", summarizer, keep_recent=10, trigger_at=20))
        assert result["compacted"] is True, result
        assert result["conversation_id"] == "legacy"
        # legacy compact 目录沿用旧布局
        artifact_id = result["compact_artifact_id"]
        assert asyncio.run(store.read_compact_artifact("p1", artifact_id)) is not None

    def test_load_repair_uses_explicit_conversation(self, tmp_path):
        """load 的投影修复也必须按显式会话执行，不串到 active。"""
        store, cid_a, cid_b = _make_two_conversations(tmp_path)
        asyncio.run(store.activate_conversation("p1", cid_b))
        # A 的事件归档存在但投影为空（模拟压缩后投影被清）
        events = asyncio.run(store.read_jsonl(store._event_path("p1", cid_a)))
        assert events
        projection_path = store._path("p1", cid_a)
        projection_path.write_text("", encoding="utf-8")
        loaded = asyncio.run(store.load("p1", conversation_id=cid_a))
        assert loaded, "A 的投影应从 A 的事件归档修复，与 active 是 B 无关"
