# -*- coding: utf-8 -*-
"""
评估修复回归（P2 嵌入分块 / P3 semantic_top_n 量纲缩放）。

P2：长候选（整卡/整事实）超 bge-small-zh 512 token 窗口时尾部字段不参与打分；
    分块 + max-over-chunks（late interaction）后尾部字段可被查询命中。
P3：纯语义窗口 = max(floor, ceil(ratio×候选数))——小语料由 floor 主导（行为
    不变），大候选池随比例增长；floor≤0 仍为完全关闭。
"""

import asyncio

from app.context_engine.models import ContextItem, ContextPriority, ContextType
from app.context_engine.retrieval_pipeline import VectorIndexAdapter, _chunk_text
from app.context_engine.select_engine import ContextSelectEngine
from app.schemas.canon import Fact


# ---------------------------------------------------------------- P2 chunk ----


class _TruncatingEmbedder:
    """模拟真实编码器的 512-token 窗口：只看输入前 600 字符。

    关键信息放在 600 字符之后时，「整段单向量」路径看不到它——这正是 P2 要修的
    截断失效模式。分块路径的尾部块在窗口内，能拿到信号。
    """

    WINDOW = 600

    @staticmethod
    def _vec(text):
        visible = str(text)[: _TruncatingEmbedder.WINDOW]
        if "口头禅" in visible:
            return [1.0, 0.0, 0.0]
        return [0.0, 1.0, 0.0]

    async def embed(self, texts):
        return [self._vec(t) for t in texts]


def _item(text: str) -> ContextItem:
    return ContextItem(
        id="x",
        type=ContextType.FACT,
        content=text,
        priority=ContextPriority.MEDIUM,
        relevance_score=0.0,
        metadata={"_index_text": text},
    )


def _long_card_with_tail_keyword() -> str:
    filler = "。".join(f"无关填充行{i}：外貌履历势力关系描写" for i in range(40))
    return filler + "\n口头禅：本座略施小计"  # 关键字段在 600 字符之后


def test_chunk_text_respects_limit_and_preserves_tail():
    text = _long_card_with_tail_keyword()
    chunks = _chunk_text(text)
    assert len(chunks) >= 2
    assert all(len(chunk) <= 600 for chunk in chunks)
    assert any("口头禅" in chunk for chunk in chunks), "尾部关键字段必须独占一个块"


def test_chunk_text_short_input_is_single_chunk():
    assert _chunk_text("短文本") == ["短文本"]
    assert _chunk_text("") == []
    assert _chunk_text("   ") == []


def test_tail_field_beyond_encoder_window_is_rescued_by_chunking():
    """分块 + max-over-chunks：600 字符外的关键字段仍拿到语义分（P2 核心断言）。"""
    adapter = VectorIndexAdapter(_TruncatingEmbedder())
    long_text = _long_card_with_tail_keyword()
    assert "口头禅" not in long_text[:600], "用例前提：关键字段确实在编码器窗口之外"

    scores = asyncio.run(adapter.scores("口头禅", [_item(long_text)], project_id="p", storage=None))
    assert scores[0] > 0.99, "尾部字段被分块救回（整段路径在此 embedder 下必然得 0）"


def test_short_text_path_unchanged_by_chunking():
    """短文本走单向量路径：与分块逻辑无关，语义分照常计算。"""
    adapter = VectorIndexAdapter(_TruncatingEmbedder())
    scores = asyncio.run(adapter.scores("口头禅", [_item("口头禅：本座略施小计")], project_id="p", storage=None))
    assert scores[0] > 0.99


def test_long_text_without_signal_scores_zero():
    adapter = VectorIndexAdapter(_TruncatingEmbedder())
    filler = "。".join(f"无关填充行{i}" for i in range(80))
    scores = asyncio.run(adapter.scores("口头禅", [_item(filler)], project_id="p", storage=None))
    assert scores[0] == 0.0


# -------------------------------------------------------------- P3 scaling ----


class _FlatEmbedder:
    """各向异性嵌入复现（同 test_phase4_retrieval）：cosine 恒正、可排名。"""

    @staticmethod
    def _vec(text):
        bias = (len(str(text)) % 7) / 100.0
        return [1.0, 0.20 + bias, 0.15]

    async def embed(self, texts):
        return [self._vec(t) for t in texts]


class _FactStorage:
    def __init__(self, facts):
        self._facts = facts

    async def get_all_facts(self, project_id):
        return list(self._facts)


def _noise_facts(count):
    return [
        Fact(id=f"N{i}", statement=f"无关设定条目{i}" + "补" * (i % 5), source="V1C001", introduced_in="V1C001")
        for i in range(count)
    ]


def _run_select(engine, count, top_k=200):
    # total_chapters 抬高候选上限（默认 50 会让 100 候选的用例被提前截断）：
    # _get_candidate_limit → min(max(80, 20×8), 1000) = 160。
    return asyncio.run(
        engine.retrieval_select(
            project_id="p",
            query="恐惧",
            item_types=["fact"],
            storage=_FactStorage(_noise_facts(count)),
            top_k=top_k,
            total_chapters=20,
        )
    )


def test_semantic_window_scales_with_candidate_pool():
    """大候选池：窗口 = max(floor 8, ceil(0.1×100)) = 10，不再被常量 8 卡死。"""
    engine = ContextSelectEngine(embeddings_service=_FlatEmbedder())
    engine._semantic_top_n = 8
    engine._semantic_top_n_ratio = 0.1
    results = _run_select(engine, 100)
    assert len(results) == 10
    trace = engine.get_last_ranking_trace()
    assert trace["filters"]["semantic_denoise_limit"] == 10
    assert trace["filters"]["semantic_denoise_excluded"] == 90


def test_semantic_window_floor_dominates_small_pools():
    """小语料：ratio×候选 < floor → floor 8 生效（候选少于 8 时不过滤，行为不变）。"""
    engine = ContextSelectEngine(embeddings_service=_FlatEmbedder())
    engine._semantic_top_n = 8
    engine._semantic_top_n_ratio = 0.1
    results = _run_select(engine, 5)
    assert len(results) == 5  # limit=8 ≥ 5 → 不过滤
    trace = engine.get_last_ranking_trace()
    assert trace["filters"]["semantic_denoise_limit"] == 5


def test_semantic_window_ratio_zero_falls_back_to_floor_only():
    engine = ContextSelectEngine(embeddings_service=_FlatEmbedder())
    engine._semantic_top_n = 8
    engine._semantic_top_n_ratio = 0.0
    results = _run_select(engine, 100)
    assert len(results) == 8


def test_semantic_window_floor_zero_stays_fully_closed():
    """floor≤0 仍表示完全关闭纯语义召回——ratio 不复活已关闭的开关。"""
    engine = ContextSelectEngine(embeddings_service=_FlatEmbedder())
    engine._semantic_top_n = 0
    engine._semantic_top_n_ratio = 0.1
    results = _run_select(engine, 100)
    assert results == []
    trace = engine.get_last_ranking_trace()
    assert trace["filters"]["semantic_denoise_limit"] == 0


def test_lexical_hits_never_dropped_by_scaled_window():
    """量纲不变量：词法命中一律保留，窗口缩放只作用于纯语义候选。"""
    engine = ContextSelectEngine(embeddings_service=_FlatEmbedder())
    engine._semantic_top_n = 0
    engine._semantic_top_n_ratio = 0.1
    facts = _noise_facts(10) + [
        Fact(id="HIT", statement="主角的恐惧来源于童年", source="V1C001", introduced_in="V1C001")
    ]
    results = asyncio.run(
        engine.retrieval_select(project_id="p", query="恐惧", item_types=["fact"], storage=_FactStorage(facts), top_k=50)
    )
    assert [r.id for r in results] == ["HIT"]
