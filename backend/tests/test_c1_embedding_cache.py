# -*- coding: utf-8 -*-
"""
文枢 WenShape - 深度上下文感知的智能体小说创作系统
WenShape - Deep Context-Aware Agent-Based Novel Writing System

Copyright © 2025-2026 WenShape Team
License: PolyForm Noncommercial License 1.0.0

模块说明 / Module Description:
  C1 编码窗口与缓存身份合同测试 - 向量缓存绑定模型空间指纹与分块版本
  （换模型不复用旧向量、同配置仍命中）；分块上限来自模型 token 窗口，
  越窗长文本被切开而非整块越界（评估报告 F09/F10）。
  C1 embedding-window & cache-identity contract tests - the vector cache is
  bound to the model-space fingerprint and chunking version (switching models
  never reuses stale vectors; same config keeps hitting), and the chunk limit
  derives from the model token window (findings F09/F10).
"""

import asyncio
from pathlib import Path

from app.context_engine.models import ContextItem, ContextPriority, ContextType
from app.context_engine.retrieval_pipeline import (
    VectorIndexAdapter,
    _chunk_char_limit,
    _chunk_text,
)


class _ModelBackend:
    """确定性嵌入后端：同 space 下文本按关键词取向量；不同 space 向量正交。"""

    def __init__(self, space: str, vector_for):
        self._space = space
        self._vector_for = vector_for

    def space_fingerprint(self):
        return self._space

    def max_input_tokens(self):
        return 512

    async def embed(self, texts):
        return [self._vector_for(str(t)) for t in texts]


def _item(content: str, index_text: str = "") -> ContextItem:
    return ContextItem(
        id=f"item_{abs(hash(content)) % 10_000}",
        type=ContextType.FACT,
        content=content,
        priority=ContextPriority.MEDIUM,
        relevance_score=0.0,
        metadata={"_index_text": index_text} if index_text else {},
    )


class TestCacheSpaceIdentity:
    """F10 探针：同文本、不同模型空间——旧向量不得复用。"""

    def test_model_switch_reembeds_documents(self, tmp_path):
        # 模型 A：A 类文本 → [1,0]；模型 B：A 类文本 → [0,1]（同维不同空间）。
        backend_a = _ModelBackend("model_a", lambda t: [1.0, 0.0] if "古镜" in t else [0.0, 1.0])
        backend_b = _ModelBackend("model_b", lambda t: [0.0, 1.0] if "古镜" in t else [1.0, 0.0])

        adapter = VectorIndexAdapter(backend_a)
        doc = _item("主角持有古镜伏笔", index_text="主角持有古镜伏笔")

        class _Storage:
            def get_embeddings_cache_path(self, project_id):
                return Path(tmp_path) / "embeddings_cache.jsonl"

        # 模型 A 建缓存
        scores_a = asyncio.run(adapter.scores("古镜", [doc], project_id="p1", storage=_Storage()))
        assert scores_a[0] > 0.99, "模型 A 下查询与文档同空间应高相似"

        # 换模型 B：同一文档与缓存文件。F10 反例要求：不得复用 A 的向量。
        adapter_b = VectorIndexAdapter(backend_b)
        embedded_texts = []
        original_embed = backend_b.embed

        async def _tracking_embed(texts):
            embedded_texts.extend(str(t) for t in texts[1:])  # 跳过 query
            return await original_embed(texts)

        backend_b.embed = _tracking_embed
        scores_b = asyncio.run(adapter_b.scores("古镜", [doc], project_id="p1", storage=_Storage()))
        assert "主角持有古镜伏笔" in embedded_texts, "换模型后文档必须重新嵌入（F10：不复用旧空间向量）"
        assert scores_b[0] > 0.99, "模型 B 下同空间查询-文档也应高相似（正交空间定义）"

    def test_same_model_repeated_query_hits_cache(self, tmp_path):
        calls = []
        backend = _ModelBackend("model_x", lambda t: [1.0, 0.0])

        async def _counting_embed(texts):
            calls.append(len(texts))
            return [[1.0, 0.0] for _ in texts]

        backend.embed = _counting_embed
        adapter = VectorIndexAdapter(backend)
        doc = _item("稳定文本", index_text="稳定文本")

        class _Storage:
            def get_embeddings_cache_path(self, project_id):
                return Path(tmp_path) / "cache.jsonl"

        asyncio.run(adapter.scores("查询", [doc], project_id="p1", storage=_Storage()))
        first_calls = len(calls)
        # 同一 adapter（同 store 缓存）：第二次查询只嵌 query，文档命中缓存
        asyncio.run(adapter.scores("查询", [doc], project_id="p1", storage=_Storage()))
        assert len(calls) == first_calls + 1, "同配置重复查询应命中缓存（embed-once 语义保持）"

    def test_legacy_cache_rows_pruned(self, tmp_path):
        """旧格式缓存键（无空间前缀）在新键写入时被清理。"""
        from app.context_engine.vector_store import VectorStore

        store_path = Path(tmp_path) / "cache.jsonl"
        legacy = VectorStore()
        legacy.upsert("deadbeef", [0.5, 0.5], text="")
        legacy.save(store_path)

        backend = _ModelBackend("model_new", lambda t: [1.0, 0.0])
        adapter = VectorIndexAdapter(backend)
        doc = _item("文本", index_text="文本")

        class _Storage:
            def get_embeddings_cache_path(self, project_id):
                return store_path

        asyncio.run(adapter.scores("查询", [doc], project_id="p1", storage=_Storage()))
        reloaded = VectorStore.load(store_path)
        keys = reloaded.ids()
        assert all("|" in key for key in keys), f"旧键应被清理（残留：{keys}）"
        assert not any(key == "deadbeef" for key in keys)


class TestChunkWindow:
    """F09：分块上限来自模型 token 窗口，越窗文本被切开。"""

    def test_chunk_limit_derives_from_model_window(self):
        backend = _ModelBackend("m", lambda t: [0.0])
        assert _chunk_char_limit(backend) == 481, "512-token 窗口 → int(512*0.94)=481 字符（安全余量）"

    def test_chunk_limit_default_without_window(self):
        class _NoWindow:
            pass

        assert _chunk_char_limit(_NoWindow()) == 480, "无窗口信息时保守默认 480"

    def test_over_window_text_is_chunked(self):
        """评估实测反例（F09）：600 汉字 ≈ 602 token 越窗——必须分块。"""
        text = "春江花月夜山水云风" * 60  # 540 字符，旧 limit 600 不切 → 越窗
        chunks = _chunk_text(text, limit=480)
        assert len(chunks) >= 2, "540 字符在 480 上限下必须分块（旧 600 阈值会整块越窗）"
        assert all(len(chunk) <= 480 for chunk in chunks)

    def test_onnx_embedder_exposes_window_and_fingerprint(self):
        from app.context_engine.embeddings import OnnxEmbedder

        embedder = OnnxEmbedder(model_name="BAAI/bge-small-zh-v1.5")
        assert embedder.max_input_tokens() == 512
        fp1 = embedder.space_fingerprint()
        assert fp1, "空间指纹非空"
        # 同模型重复实例指纹稳定（缓存仍命中）；换模型即变。
        assert OnnxEmbedder(model_name="BAAI/bge-small-zh-v1.5").space_fingerprint() == fp1
        assert OnnxEmbedder(model_name="BAAI/bge-large-zh-v1.5").space_fingerprint() != fp1
