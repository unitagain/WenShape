# -*- coding: utf-8 -*-
"""
文枢 WenShape - 深度上下文感知的智能体小说创作系统
WenShape - Deep Context-Aware Agent-Based Novel Writing System

Copyright © 2025-2026 WenShape Team
License: PolyForm Noncommercial License 1.0.0

模块说明 / Module Description:
  A3 统一记忆准入合同测试 - 目录推送与正文召回执行同一 eligibility
  （CreativeMemoryStorage.eligible_headers 唯一规则集），章节时点用结构化
  比较（评估报告 F04）。
  A3 memory eligibility contract tests - the inventory push and body recall
  share one eligibility rule set; chapter as-of uses structured comparison
  (finding F04).
"""

import asyncio
from datetime import datetime, timedelta, timezone

from app.agents.tools import WriterToolset
from app.orchestrator.writing_service import WritingService
from app.storage.creative_memory import CreativeMemoryStorage

_PAST = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()


def _storage(tmp_path) -> CreativeMemoryStorage:
    return CreativeMemoryStorage(str(tmp_path))


def _seed_valid(tmp_path, storage=None):
    storage = storage or _storage(tmp_path)
    asyncio.run(
        storage.write_memory("p1", "tone", "有效偏好：冷峻克制文风", "避免煽情", "preference")
    )
    return storage


def _writing_service(memory_storage) -> WritingService:
    return WritingService(
        gateway=None,
        writer=None,
        draft_storage=None,
        storage_adapter=None,
        select_engine=None,
        context_assembly=None,
        memory_storage=memory_storage,
    )


def _toolset(tmp_path, storage, current_chapter="V1C001") -> WriterToolset:
    return WriterToolset(
        "p1",
        None,
        None,
        current_chapter=current_chapter,
        outline_enabled=True,
        defer_writes=True,
        memory_storage=storage,
    )


class TestInventoryAndRecallShareEligibility:
    """F04 反例 1：过期/冲突的 active 记忆——目录与正文一致排除。"""

    def test_expired_active_memory_hidden_from_both(self, tmp_path):
        storage = _seed_valid(tmp_path)
        asyncio.run(
            storage.write_memory(
                "p1", "stale", "已过期偏好：旧文风描述EXPIRED", "…", "preference", expires_at=_PAST
            )
        )

        eligible = asyncio.run(storage.eligible_headers("p1"))
        names = {item["name"] for item in eligible}
        assert "有效偏好：冷峻克制文风" in names or "tone" in names
        assert "已过期偏好：旧文风描述EXPIRED" not in names

        push = asyncio.run(_writing_service(storage)._resolve_memory_inventory_push("p1"))
        assert "EXPIRED" not in push, "过期记忆的描述不得进入 system prompt 目录"

        recalled = asyncio.run(storage.recall("p1", "旧文风", 5))
        assert all("EXPIRED" not in str(item.get("description") or "") for item in recalled)

    def test_conflicting_active_memories_hidden_from_both(self, tmp_path):
        storage = _seed_valid(tmp_path)
        # 先写被引用方，再写引用方（写入校验要求 conflicts_with 引用已存在；
        # build_memory_graph 单向引用即让双方都进入 conflict_participants）。
        asyncio.run(storage.write_memory("p1", "conflict-b", "冲突偏好乙CONFLICT_B", "…", "preference"))
        asyncio.run(
            storage.write_memory(
                "p1", "conflict-a", "冲突偏好甲CONFLICT_A", "…", "preference", conflicts_with=["conflict-b"]
            )
        )

        eligible = asyncio.run(storage.eligible_headers("p1"))
        descriptions = " ".join(str(item.get("description") or "") for item in eligible)
        assert "CONFLICT_A" not in descriptions and "CONFLICT_B" not in descriptions

        push = asyncio.run(_writing_service(storage)._resolve_memory_inventory_push("p1"))
        assert "CONFLICT_A" not in push and "CONFLICT_B" not in push

        recalled = asyncio.run(storage.recall("p1", "冲突偏好", 10))
        assert all(
            "CONFLICT" not in str(item.get("description") or "") for item in recalled
        ), "未决冲突记忆不得召回"

    def test_superseded_memory_hidden_from_both(self, tmp_path):
        storage = _seed_valid(tmp_path)
        asyncio.run(
            storage.write_memory("p1", "old-decision", "被取代的旧决定SUPERSEDED_OLD", "…", "decision")
        )
        asyncio.run(
            storage.write_memory(
                "p1",
                "new-decision",
                "新决定SUPERSEDED_NEW",
                "…",
                "decision",
                supersedes=["old-decision"],
            )
        )

        eligible = asyncio.run(storage.eligible_headers("p1"))
        descriptions = " ".join(str(item.get("description") or "") for item in eligible)
        assert "SUPERSEDED_NEW" in descriptions
        assert "SUPERSEDED_OLD" not in descriptions, "被取代记忆不得进入 eligible 集合"

        push = asyncio.run(_writing_service(storage)._resolve_memory_inventory_push("p1"))
        assert "SUPERSEDED_OLD" not in push
        assert "SUPERSEDED_NEW" in push

    def test_valid_memory_still_visible_in_both(self, tmp_path):
        """有效记忆不误杀：目录与召回均可见。"""
        storage = _seed_valid(tmp_path)
        push = asyncio.run(_writing_service(storage)._resolve_memory_inventory_push("p1"))
        assert "冷峻克制" in push
        recalled = asyncio.run(storage.recall("p1", "文风", 5))
        assert any("冷峻克制" in str(item.get("description") or "") for item in recalled)


class TestChapterAsOfStructuredComparison:
    """F04 反例 2：未来章节记忆不向过去章节泄漏；章节时点用结构化比较。"""

    def test_future_chapter_memory_blocked_for_earlier_chapter(self, tmp_path):
        storage = _seed_valid(tmp_path)
        asyncio.run(
            storage.write_memory(
                "p1",
                "future-twist",
                "未来章节剧情决定FUTURE_TWIST",
                "…",
                "decision",
                scope="chapter",
                valid_from="V1C10",
            )
        )

        # V1C1 写作：未来记忆（V1C10 起）在目录与召回中均不可见
        push = asyncio.run(_writing_service(storage)._resolve_memory_inventory_push("p1", "V1C1"))
        assert "FUTURE_TWIST" not in push, "未来章节记忆不得进入早期章节的目录推送"
        recalled = asyncio.run(storage.recall("p1", "剧情决定", 10, as_of="V1C1"))
        assert all("FUTURE_TWIST" not in str(item.get("description") or "") for item in recalled)

        # 到达 V1C10 之后：可见
        push_late = asyncio.run(_writing_service(storage)._resolve_memory_inventory_push("p1", "V1C12"))
        assert "FUTURE_TWIST" in push_late
        recalled_late = asyncio.run(storage.recall("p1", "剧情决定", 10, as_of="V1C12"))
        assert any("FUTURE_TWIST" in str(item.get("description") or "") for item in recalled_late)

    def test_structured_beats_string_comparison_for_legacy_chapter_ids(self, tmp_path):
        """结构化比较反例：valid_from="C10"（第 10 章）对 as_of="V1C2" 是未来信息。

        旧字符串比较 ``"C10" < "V1C2"``（'C'<'V'）会错误放行——正是 F04 要求
        章节时点用结构化顺序的原因。
        """
        storage = _seed_valid(tmp_path)
        asyncio.run(
            storage.write_memory(
                "p1",
                "legacy-future",
                "旧格式未来记忆LEGACY_FUTURE",
                "…",
                "decision",
                scope="chapter",
                valid_from="C10",
            )
        )
        recalled = asyncio.run(storage.recall("p1", "未来记忆", 10, as_of="V1C2"))
        assert all(
            "LEGACY_FUTURE" not in str(item.get("description") or "") for item in recalled
        ), "C10 = V1C10，对 V1C2 是未来，字符串比较会错误泄漏"

    def test_query_memory_tool_passes_chapter_as_of(self, tmp_path):
        """真实工具链：query_memory 以 WriterToolset 的 current_chapter 为时点。"""
        storage = _seed_valid(tmp_path)
        asyncio.run(
            storage.write_memory(
                "p1",
                "future-tool",
                "工具层未来记忆TOOL_FUTURE",
                "正文TOOL_FUTURE_BODY",
                "decision",
                scope="chapter",
                valid_from="V1C10",
            )
        )
        toolset = _toolset(tmp_path, storage, current_chapter="V1C001")
        result = asyncio.run(toolset.execute("query_memory", {"query": "未来记忆", "top_k": 10}))
        assert "TOOL_FUTURE" not in result, "工具召回必须带章节时点，未来记忆不泄漏"

        toolset_late = _toolset(tmp_path, storage, current_chapter="V1C012")
        result_late = asyncio.run(toolset_late.execute("query_memory", {"query": "未来记忆", "top_k": 10}))
        assert "TOOL_FUTURE" in result_late, "到达章节后可见（不误杀）"

    def test_chapter_memory_visible_within_same_chapter(self, tmp_path):
        """当章可见：valid_from=V1C5、as_of=V1C5 不算未来。"""
        storage = _seed_valid(tmp_path)
        asyncio.run(
            storage.write_memory(
                "p1",
                "same-chapter",
                "当章记忆SAME_CHAPTER",
                "…",
                "decision",
                scope="chapter",
                valid_from="V1C5",
            )
        )
        recalled = asyncio.run(storage.recall("p1", "当章记忆", 10, as_of="V1C5"))
        assert any("SAME_CHAPTER" in str(item.get("description") or "") for item in recalled)
