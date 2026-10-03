# -*- coding: utf-8 -*-
"""
文枢 WenShape - 深度上下文感知的智能体小说创作系统
WenShape - Deep Context-Aware Agent-Based Novel Writing System

Copyright © 2025-2026 WenShape Team
License: PolyForm Noncommercial License 1.0.0

模块说明 / Module Description:
  B1 来源版本接线合同测试 - JIT 读取（卡片/Canon/大纲/章节/关系）把触达的磁盘
  资产登记为带路径/版本的 mutable source；读取后源变化在下一次模型请求前被
  verify_mutable_sources 检出（评估报告 F03）。
  B1 source-version contract tests - JIT reads register the touched on-disk
  assets as mutable sources with path/revision; changing a source after the
  read is detected by verify_mutable_sources before the next model request
  (finding F03).
"""

import asyncio
from pathlib import Path

from app.agents.tools import WriterToolset
from app.context_engine.turn_scope import bind_turn_scope, new_turn_scope
from app.orchestrator.storage_adapter import UnifiedStorageAdapter
from app.schemas.card import CharacterCard, WorldCard
from app.storage.canon import CanonStorage
from app.storage.cards import CardStorage
from app.storage.drafts import DraftStorage
from app.storage.outline import OutlineStorage


class _FakeSelect:
    async def retrieval_select(self, **kwargs):
        return []


def _assemble(tmp_path):
    """生产同款链路：真实存储 + UnifiedStorageAdapter + WriterToolset。"""
    card = CardStorage(str(tmp_path))
    canon = CanonStorage(str(tmp_path))
    draft = DraftStorage(str(tmp_path))
    outline = OutlineStorage(str(tmp_path))
    adapter = UnifiedStorageAdapter(
        card_storage=card, canon_storage=canon, draft_storage=draft, outline_storage=outline
    )
    toolset = WriterToolset("p1", adapter, _FakeSelect(), current_chapter="V1C10", total_chapters=10)
    return card, draft, outline, adapter, toolset


def _scope_with_plan(project_root: Path):
    """激活 source_closure_required 的 turn scope（模拟 ContextPlan 激活后的最小状态）。"""
    scope = new_turn_scope(project_id="p1", chapter_id="V1C10")
    # source_closure_required 读 plans[-1].policy；用最小计划对象承载该策略位。
    scope.plans.append(
        type("Plan", (), {"project_root": str(project_root), "policy": {"source_closure_required": True}})()
    )
    scope.source_registry.project_root = project_root
    return scope


class TestJitReadsRegisterMutableSources:
    """F03 反例：读取后修改源，下一次请求前的校验必须失败（不再 valid/checked=0）。"""

    def test_card_source_change_detected_after_read(self, tmp_path):
        card, _, _, adapter, toolset = _assemble(tmp_path)
        asyncio.run(card.save_character_card("p1", CharacterCard(name="千逸", description="旧设定OLD")))
        project_root = Path(tmp_path) / "p1"

        scope = _scope_with_plan(project_root)

        async def read_card():
            return await toolset.execute("lookup_card", {"name": "千逸"})

        with bind_turn_scope(scope):
            result = asyncio.run(read_card())
        assert "旧设定OLD" in result

        # 登记发生：mutable source 非空
        verification = scope.source_registry.verify_mutable_sources()
        assert verification["checked"] >= 1, "卡片读取必须登记为 mutable source（F03：不再 checked=0）"

        # F03 探针：读取后源更新为 NEW → 校验失败
        asyncio.run(card.save_character_card("p1", CharacterCard(name="千逸", description="新设定NEW")))
        verification2 = scope.source_registry.verify_mutable_sources()
        assert verification2["valid"] is False
        assert any(f.get("reason") == "content_sha256_mismatch" for f in verification2["failures"])

    def test_world_card_version_is_registered(self, tmp_path):
        card, _, _, _, toolset = _assemble(tmp_path)
        asyncio.run(card.save_world_card("p1", WorldCard(name="古城", description="旧世界设定")))
        scope = _scope_with_plan(tmp_path / "p1")
        with bind_turn_scope(scope):
            assert "旧世界设定" in asyncio.run(toolset.execute("lookup_card", {"name": "古城"}))
        asyncio.run(card.save_world_card("p1", WorldCard(name="古城", description="新世界设定")))
        assert scope.source_registry.verify_mutable_sources()["valid"] is False

    def test_memory_body_change_is_detected_even_with_unchanged_index(self, tmp_path):
        from app.storage.creative_memory import CreativeMemoryStorage

        _, _, _, _, toolset = _assemble(tmp_path)
        memory = CreativeMemoryStorage(str(tmp_path))
        toolset.memory_storage = memory
        asyncio.run(memory.write_memory("p1", "tone", "文风偏好", "旧正文约束"))
        scope = _scope_with_plan(tmp_path / "p1")
        with bind_turn_scope(scope):
            assert "旧正文约束" in asyncio.run(toolset.execute("query_memory", {"query": "文风"}))
        path = tmp_path / "p1" / "memory" / "tone.md"
        path.write_text(path.read_text(encoding="utf-8").replace("旧正文约束", "新正文约束"), encoding="utf-8")
        verification = scope.source_registry.verify_mutable_sources()
        assert verification["valid"] is False
        assert any(f.get("reason") == "content_sha256_mismatch" for f in verification["failures"])

    def test_outline_source_change_detected_after_read(self, tmp_path):
        _, _, outline, adapter, toolset = _assemble(tmp_path)
        asyncio.run(outline.save_outline("p1", "第一卷：起始之章\n伏笔：古镜"))
        scope = _scope_with_plan(Path(tmp_path) / "p1")

        with bind_turn_scope(scope):
            result = asyncio.run(toolset.execute("read_outline", {}))
        assert "古镜" in result

        verification = scope.source_registry.verify_mutable_sources()
        assert verification["checked"] >= 1
        asyncio.run(outline.save_outline("p1", "第一卷：改写后的大纲"))
        verification2 = scope.source_registry.verify_mutable_sources()
        assert verification2["valid"] is False

    def test_chapter_source_change_detected_after_read(self, tmp_path):
        _, draft, _, adapter, toolset = _assemble(tmp_path)
        asyncio.run(draft.save_current_draft("p1", "V1C001", "章节正文OLD_CONTENT"))
        scope = _scope_with_plan(Path(tmp_path) / "p1")

        with bind_turn_scope(scope):
            result = asyncio.run(toolset.execute("read_chapter", {"chapter_id": "V1C001"}))
        assert "OLD_CONTENT" in result

        verification = scope.source_registry.verify_mutable_sources()
        assert verification["checked"] >= 1
        asyncio.run(draft.save_current_draft("p1", "V1C001", "章节正文NEW_CONTENT"))
        verification2 = scope.source_registry.verify_mutable_sources()
        assert verification2["valid"] is False

    def test_canon_facts_registered_after_query(self, tmp_path):
        _, _, _, adapter, toolset = _assemble(tmp_path)
        facts_path = Path(tmp_path) / "p1" / "canon" / "facts.jsonl"
        facts_path.parent.mkdir(parents=True, exist_ok=True)
        facts_path.write_text('{"id": "f1", "content": "千逸持有古镜", "status": "confirmed"}\n', encoding="utf-8")
        scope = _scope_with_plan(Path(tmp_path) / "p1")

        with bind_turn_scope(scope):
            asyncio.run(toolset.execute("query_canon", {"query": "古镜", "top_k": 5}))

        verification = scope.source_registry.verify_mutable_sources()
        assert verification["checked"] >= 1, "query_canon 必须登记 facts.jsonl 为 mutable source"
        facts_path.write_text('{"id": "f1", "content": "千逸持有古剑", "status": "confirmed"}\n', encoding="utf-8")
        verification2 = scope.source_registry.verify_mutable_sources()
        assert verification2["valid"] is False

    def test_no_registration_without_closure_required(self, tmp_path):
        """无计划/独立调用（source_closure_required=False）不登记——能力降级不报错。"""
        card, _, _, adapter, toolset = _assemble(tmp_path)
        asyncio.run(card.save_character_card("p1", CharacterCard(name="千逸", description="x")))
        scope = new_turn_scope(project_id="p1")

        with bind_turn_scope(scope):
            result = asyncio.run(toolset.execute("lookup_card", {"name": "千逸"}))
        assert "千逸" in result
        verification = scope.source_registry.verify_mutable_sources()
        assert verification == {"valid": True, "checked": 0, "failures": []}

    def test_unchanged_sources_still_valid(self, tmp_path):
        """源未变化时校验通过——登记不引入误报。"""
        card, _, _, adapter, toolset = _assemble(tmp_path)
        asyncio.run(card.save_character_card("p1", CharacterCard(name="千逸", description="稳定设定")))
        scope = _scope_with_plan(Path(tmp_path) / "p1")

        with bind_turn_scope(scope):
            asyncio.run(toolset.execute("lookup_card", {"name": "千逸"}))

        verification = scope.source_registry.verify_mutable_sources()
        assert verification["valid"] is True
        assert verification["checked"] >= 1
