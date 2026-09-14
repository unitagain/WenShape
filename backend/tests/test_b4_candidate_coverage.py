# -*- coding: utf-8 -*-
"""
文枢 WenShape - 深度上下文感知的智能体小说创作系统
WenShape - Deep Context-Aware Agent-Based Novel Writing System

Copyright © 2025-2026 WenShape Team
License: PolyForm Noncommercial License 1.0.0

模块说明 / Module Description:
  B4 长篇候选覆盖合同测试 - 章节数接进候选上限（total_chapters 接线），
  且 facts 候选截断前先按查询相关性排序，早期伏笔在长篇语料下仍能进入
  候选池并通过精确查询找回（评估报告 F07）。
  B4 long-form candidate coverage - total_chapters is wired into the candidate
  limit and facts are sorted by query relevance *before* truncation, so an
  early-chapter fact with an exact query hit survives the recency cut (F07).
"""

import asyncio
from dataclasses import dataclass

from app.agents.tools import WriterToolset
from app.context_engine.select_engine import ContextSelectEngine
from app.storage.drafts import DraftStorage


@dataclass
class _FakeFact:
    id: str
    statement: str
    introduced_in: str
    status: str = "confirmed"
    context_prefix: str = ""
    source: str = "test"


class _FactsAdapter:
    """提供 facts 的最小 adapter（candidate_source.facts 消费 get_eligible_facts）。"""

    def __init__(self, facts):
        self._facts = facts

    async def get_eligible_facts(self, project_id):
        return self._facts

    async def get_all_facts(self, project_id):
        return self._facts


def _fact_pool(chapters: int = 80):
    """80 条事实分布在前 80 章；唯一精确哨兵词在第 1 章（F07 探针语料）。"""
    facts = [
        _FakeFact(id=f"F{i + 1:03d}", statement=f"第{i + 1}章的常规事实填充内容{i}", introduced_in=f"V1C{i + 1:03d}")
        for i in range(chapters)
    ]
    facts[0] = _FakeFact(
        id="F001",
        statement="EARLY_SECRET_PHRASE 古镜的来历是第一卷的核心伏笔",
        introduced_in="V1C001",
    )
    return facts


def _run_select(facts, query, *, current_chapter="V1C080", total_chapters=80):
    engine = ContextSelectEngine()
    adapter = _FactsAdapter(facts)
    items = asyncio.run(
        engine.retrieval_select(
            "p1",
            query,
            ["fact"],
            adapter,
            top_k=5,
            current_chapter=current_chapter,
            total_chapters=total_chapters,
        )
    )
    return items, engine


class TestFactCandidateCoverage:
    """F07 探针：首章精确命中词在长篇候选池下必须找回。"""

    def test_exact_hit_in_chapter_one_is_found(self):
        facts = _fact_pool(80)
        items, _ = _run_select(facts, "EARLY_SECRET_PHRASE")
        assert any("EARLY_SECRET_PHRASE" in str(item.content) for item in items), (
            "首章精确命中必须进入 top-k（相关性优先于 recency 截断）"
        )

    def test_zero_total_chapters_still_finds_exact_hit(self):
        """旧缺陷复现对照组：total_chapters=0（候选上限 50）+ 相关性预排序也应命中。

        相关性预排序本身就能救回早期事实——接线 total_chapters 进一步扩大
        候选池，两者是独立防线。
        """
        facts = _fact_pool(80)
        items, _ = _run_select(facts, "EARLY_SECRET_PHRASE", total_chapters=0)
        assert any("EARLY_SECRET_PHRASE" in str(item.content) for item in items)

    def test_semantic_query_still_ranks_recent_facts(self):
        """距离衰减不被破坏：词法同分时近期事实仍靠前（排序键 recency 次之）。"""
        facts = [
            _FakeFact(id="A", statement="古镜伏笔内容版本甲", introduced_in="V1C001"),
            _FakeFact(id="B", statement="古镜伏笔内容版本乙", introduced_in="V1C080"),
        ]
        items, _ = _run_select(facts, "古镜伏笔", current_chapter="V1C080")
        contents = [str(item.content) for item in items]
        assert len(contents) == 2
        # 两条词法同分 → recency 决定先后：近期（版本乙）优先。
        assert contents.index("古镜伏笔内容版本乙") < contents.index("古镜伏笔内容版本甲")


class TestTotalChaptersWiring:
    """生产装配接线：WritingService 创建 WriterToolset 时传入真实章节数。"""

    def test_writing_service_passes_total_chapters(self, tmp_path, monkeypatch):
        """真实 WritingService 装配：existing_chapters 数量进入 WriterToolset。"""
        from app.orchestrator.writing_service import WritingService

        draft = DraftStorage(str(tmp_path))
        for i in (1, 2, 3, 4, 5, 6):
            asyncio.run(draft.save_current_draft("p1", f"V1C{i:03d}", f"第{i}章正文"))

        captured = {}

        class _Capture:
            """捕获 WriterToolset 构造参数的替身。"""

            def __call__(self, *args, **kwargs):
                captured["args"] = args
                captured["kwargs"] = kwargs
                real = WriterToolset(*args, **kwargs)
                return real

        monkeypatch.setattr("app.orchestrator.writing_service.WriterToolset", _Capture())

        service = WritingService(
            gateway=None,
            writer=None,
            draft_storage=draft,
            storage_adapter=None,
            select_engine=None,
            context_assembly=None,
            memory_storage=None,
        )

        # run() 前期就会构造 toolset；让后续链路尽早失败即可（storage_adapter=None）。
        try:
            asyncio.run(service.run("p1", "V1C006", "写一段"))
        except Exception:
            pass  # 装配后的执行失败不影响接线断言

        kwargs = captured.get("kwargs") or {}
        assert int(kwargs.get("total_chapters") or 0) == 6, (
            "existing_chapters 数量必须传入 WriterToolset（F07：缺省 0 使候选上限退回 50）"
        )
