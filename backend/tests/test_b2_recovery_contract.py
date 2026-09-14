# -*- coding: utf-8 -*-
"""
文枢 WenShape - 深度上下文感知的智能体小说创作系统
WenShape - Deep Context-Aware Agent-Based Novel Writing System

Copyright © 2025-2026 WenShape Team
License: PolyForm Noncommercial License 1.0.0

模块说明 / Module Description:
  B2 完整原文与可恢复投影合同测试 - 被工具截断省略的内容（长卡尾部、
  章节中部、折叠工具输出）都能经 Writer 实际可用工具恢复（评估报告 F02）。
  B2 recovery contract tests - content omitted by tool truncation (long card
  tail, chapter middle, folded tool output) is recoverable through tools the
  Writer actually has (finding F02).
"""

import asyncio

from app.agents.tools import WriterToolset
from app.context_engine.tool_artifact import ToolArtifactStore
from app.context_engine.tool_registry import get_tool_spec, tool_loadout_for_route
from app.orchestrator.storage_adapter import UnifiedStorageAdapter
from app.storage.canon import CanonStorage
from app.storage.cards import CardStorage
from app.storage.drafts import DraftStorage
from app.storage.outline import OutlineStorage


class _FakeSelect:
    async def retrieval_select(self, **kwargs):
        return []


def _toolset(tmp_path, current_chapter="V1C010"):
    card = CardStorage(str(tmp_path))
    adapter = UnifiedStorageAdapter(
        card_storage=card,
        canon_storage=CanonStorage(str(tmp_path)),
        draft_storage=DraftStorage(str(tmp_path)),
        outline_storage=OutlineStorage(str(tmp_path)),
    )
    return (
        card,
        DraftStorage(str(tmp_path)),
        WriterToolset("p1", adapter, _FakeSelect(), current_chapter=current_chapter, total_chapters=10),
    )


class TestChapterMiddleRecovery:
    """F02 探针 1：章节中部哨兵经 offset/length 范围读取恢复。"""

    def test_middle_sentinel_recoverable_by_range_read(self, tmp_path):
        card, draft, toolset = _toolset(tmp_path)
        # 长章：首尾片段省略中段；唯一哨兵在正中（首尾各 1600 字符覆盖不到）。
        head = "开头铺垫。" * 500  # ~2500 字符
        middle = "中部核心伏笔MIDDLE_SENTINEL古镜认主。"
        tail = "结尾收束。" * 500  # ~2500 字符
        asyncio.run(draft.save_current_draft("p1", "V1C001", head + middle + tail))

        first = asyncio.run(toolset.execute("read_chapter", {"chapter_id": "V1C001"}))
        assert "MIDDLE_SENTINEL" not in first, "默认首尾片段不含中段（反例前提成立）"

        # 恢复：范围读取中段（首 2500 字符之后）。
        recovered = asyncio.run(
            toolset.execute("read_chapter", {"chapter_id": "V1C001", "offset": 2400, "length": 400})
        )
        assert "MIDDLE_SENTINEL" in recovered, "中段必须可经范围读取恢复（F02）"

    def test_range_read_bounds_and_errors(self, tmp_path):
        card, draft, toolset = _toolset(tmp_path)
        asyncio.run(draft.save_current_draft("p1", "V1C001", "短章。"))
        out = asyncio.run(toolset.execute("read_chapter", {"chapter_id": "V1C001", "offset": 999, "length": 10}))
        assert "超出范围" in out, "越界 offset 必须显式报错，不静默返回空"


class TestArtifactRecovery:
    """F02 探针 2：折叠/截断的工具输出经 read_tool_artifact 恢复完整内容。"""

    def test_full_output_recoverable_by_artifact_ref(self, tmp_path):
        store = ToolArtifactStore()
        full_output = "完整工具输出。\n" + "中间大量内容。" * 500 + "\n尾部哨兵TAIL_SENTINEL。"
        artifact = store.persist(
            full_output, turn_id="t1", tool_call_id="c1", tool_name="query_canon", status="succeeded"
        )

        card, draft, toolset = _toolset(tmp_path)
        # 模型从预览里看到 artifact_ref，调用恢复工具。
        result = asyncio.run(
            toolset.execute("read_tool_artifact", {"artifact_ref": artifact.artifact_ref})
        )
        assert "TAIL_SENTINEL" in result, "尾部哨兵必须可恢复（预览截断处之后的内容）"
        assert "query_canon" in result

    def test_artifact_range_read(self, tmp_path):
        store = ToolArtifactStore()
        full = "A" * 3000 + "NEEDLE_IN_MIDDLE" + "B" * 3000
        artifact = store.persist(full, turn_id="t1", tool_call_id="c1", tool_name="search_prose", status="succeeded")
        card, draft, toolset = _toolset(tmp_path)
        result = asyncio.run(
            toolset.execute(
                "read_tool_artifact", {"artifact_ref": artifact.artifact_ref, "offset": 2800, "length": 400}
            )
        )
        assert "NEEDLE_IN_MIDDLE" in result

    def test_expired_artifact_fails_explicitly(self, tmp_path):
        """过期引用显式失败：把已持久化 artifact 的 expires_at 改写到过去。"""
        import json
        import time as _time

        store = ToolArtifactStore()
        artifact = store.persist("x", turn_id="t", tool_call_id="c", tool_name="t", status="succeeded")
        path = store._path_for_ref(artifact.artifact_ref)
        payload = json.loads(path.read_text(encoding="utf-8"))
        payload["expires_at"] = _time.time() - 1
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

        card, draft, toolset = _toolset(tmp_path)
        result = asyncio.run(toolset.execute("read_tool_artifact", {"artifact_ref": artifact.artifact_ref}))
        assert "artifact_expired" in result, "过期引用必须显式失败（B2 验收）"
        assert "无法恢复" in result

    def test_missing_ref_and_argument(self, tmp_path):
        card, draft, toolset = _toolset(tmp_path)
        assert "需要 artifact_ref" in asyncio.run(toolset.execute("read_tool_artifact", {}))
        result = asyncio.run(toolset.execute("read_tool_artifact", {"artifact_ref": "toolartifact:deadbeef"}))
        assert "artifact_error" in result or "artifact_expired" in result, "不存在的引用必须显式失败"


class TestToolRegistration:
    """恢复入口必须真实可用：schema + registry + loadout 三处同步登记。"""

    def test_read_tool_artifact_in_schemas(self, tmp_path):
        card, draft, toolset = _toolset(tmp_path)
        names = {s["function"]["name"] for s in toolset.schemas()}
        assert "read_tool_artifact" in names

    def test_registered_with_permission(self):
        spec = get_tool_spec("read_tool_artifact")
        assert spec is not None, "read_tool_artifact 未在 tool_registry 注册（漏登记即 permission_denied）"
        assert spec.read_only is True
        assert "agentic_writer" in spec.enabled_for
        assert "plan_workflow" in spec.enabled_for
        allowed = {item["name"] for item in tool_loadout_for_route("agentic_writer")}
        assert "read_tool_artifact" in allowed

    def test_truncation_marker_points_to_recovery(self, tmp_path):
        """截断/省略标记必须指向恢复路径（模型可自纠的显式提示）。"""
        card, draft, toolset = _toolset(tmp_path)
        asyncio.run(draft.save_current_draft("p1", "V1C001", "很长的正文。" * 2000))
        first = asyncio.run(toolset.execute("read_chapter", {"chapter_id": "V1C001"}))
        assert "中略" in first
        assert "offset" in first, "省略标记须指向范围读取恢复方式"
