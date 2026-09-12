"""Composable retrieval components used by ContextSelectEngine."""

from __future__ import annotations

import hashlib
import re
from typing import Any, Dict, Iterable, List, Optional

from app.context_engine.embeddings import cosine_similarity
from app.context_engine.models import ContextItem
from app.context_engine.vector_store import VectorStore
from app.utils.chapter_id import ChapterIDValidator
from app.utils.logger import get_logger

logger = get_logger(__name__)

RRF_K = 60

# Late-interaction 分块阈值：bge-small-zh 的输入窗口为 512 token（中文约 1 字 ≈ 1 token），
# 整卡/整事实单向量会把超窗的尾部字段直接截断、不参与打分。超过该保守字符数的索引文本
# 按行/句边界分块，候选语义分取各块与 query 的最大 cosine（max-over-chunks）。
_CHUNK_CHAR_LIMIT = 600

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[。！？；!?;])")


def _split_long_line(line: str, limit: int) -> List[str]:
    """把超过 limit 的单行按句界切开；仍超长的句子按 limit 硬切。"""

    pieces: List[str] = []
    for sentence in _SENTENCE_SPLIT_RE.split(line):
        if len(sentence) <= limit:
            pieces.append(sentence)
            continue
        pieces.extend(sentence[i : i + limit] for i in range(0, len(sentence), limit))
    return pieces


def _chunk_text(text: str, *, limit: int = _CHUNK_CHAR_LIMIT) -> List[str]:
    """把长索引文本切成 ≤limit 的块，边界优先取换行与句号。

    空文本返回空列表（该候选语义分为 0，与历史行为一致）。
    """

    text = str(text or "")
    if not text.strip():
        return []
    if len(text) <= limit:
        return [text]
    chunks: List[str] = []
    current: List[str] = []
    length = 0
    for line in text.split("\n"):
        for piece in _split_long_line(line, limit):
            if length and length + len(piece) + 1 > limit:
                chunks.append("\n".join(current))
                current, length = [], 0
            current.append(piece)
            length += len(piece) + 1
    if current:
        chunks.append("\n".join(current))
    return [chunk for chunk in chunks if chunk.strip()]


class StorageCandidateSource:
    """Typed adapter over the heterogeneous project storage APIs."""

    @staticmethod
    async def facts(storage: Any, project_id: str) -> List[Any]:
        getter = getattr(storage, "get_eligible_facts", None)
        if callable(getter):
            return list(await getter(project_id) or [])
        return [
            fact
            for fact in list(await storage.get_all_facts(project_id) or [])
            if str(getattr(fact, "status", "needs_review") or "needs_review") == "confirmed"
        ]

    @staticmethod
    async def character_names(storage: Any, project_id: str) -> List[str]:
        return list(await storage.list_character_cards(project_id) or [])

    @staticmethod
    async def character(storage: Any, project_id: str, name: str) -> Any:
        return await storage.get_character_card(project_id, name)

    @staticmethod
    async def world_names(storage: Any, project_id: str) -> List[str]:
        return list(await storage.list_world_cards(project_id) or [])

    @staticmethod
    async def world(storage: Any, project_id: str, name: str) -> Any:
        return await storage.get_world_card(project_id, name)

    @staticmethod
    async def text_chunks(storage: Any, project_id: str, query: str, *, limit: int) -> List[Dict[str, Any]]:
        return list(await storage.search_text_chunks(project_id, query, limit=limit) or [])


class TemporalScopeFilter:
    """Own all as-of chapter filtering decisions."""

    @staticmethod
    def is_future(candidate_chapter: str, current_chapter: Optional[str]) -> bool:
        return bool(
            current_chapter
            and candidate_chapter
            and ChapterIDValidator.is_after(str(candidate_chapter), str(current_chapter))
        )


class ContextualIndexBuilder:
    """Build retrieval-only text while preserving display content."""

    @staticmethod
    def build(content: str, metadata: Dict[str, Any]) -> str:
        parts: List[str] = []
        source_type = str((metadata or {}).get("source_type") or "").strip()
        if source_type:
            parts.append(f"类型:{source_type}")
        name = str((metadata or {}).get("name") or "").strip()
        if name:
            parts.append(f"名称:{name}")
        chapter = str((metadata or {}).get("chapter") or (metadata or {}).get("introduced_in") or "").strip()
        if chapter:
            parts.append(f"章节:{chapter}")
        context_prefix = str((metadata or {}).get("context_prefix") or "").strip()
        if context_prefix:
            parts.append(f"情境:{context_prefix}")
        source = (metadata or {}).get("source")
        if isinstance(source, dict):
            source_chapter = str(source.get("chapter") or source.get("source") or "").strip()
            if source_chapter:
                parts.append(f"来源:{source_chapter}")
        prefix = " ".join(dict.fromkeys(parts))
        body = str(content or "").strip()
        return f"{prefix}\n{body}".strip() if prefix else body


class VectorIndexAdapter:
    """Own content-addressed embedding cache and semantic scoring.

    Long candidates (whole cards, prefixed facts) are chunked at line/sentence
    boundaries and score by their best-matching chunk (late interaction), so
    fields beyond the encoder's 512-token window still compete for the query
    signal instead of being silently truncated away. Chunk vectors are cached
    by content hash exactly like whole-text vectors, so embed-once semantics
    carry over at chunk granularity.
    """

    def __init__(self, embeddings: Any):
        self.embeddings = embeddings
        self._stores: Dict[str, VectorStore] = {}
        self._paths: Dict[str, Any] = {}

    async def scores(
        self, query: str, candidates: List[ContextItem], *, project_id: str = "", storage: Any = None
    ) -> List[float]:
        segment_lists: List[List[str]] = []
        for item in candidates:
            text = str(item.metadata.get("_index_text") or item.content or "")
            if 0 < len(text) <= _CHUNK_CHAR_LIMIT:
                segments = [text]
            else:
                segments = _chunk_text(text)
            segment_lists.append(segments)
        store = self._get_store(project_id, storage)
        segment_hashes: List[List[str]] = [
            [hashlib.sha1(segment.encode("utf-8")).hexdigest() for segment in segments]
            for segments in segment_lists
        ]
        misses: Dict[str, str] = {}
        for segments, hashes in zip(segment_lists, segment_hashes):
            for segment, content_hash in zip(segments, hashes):
                if segment and not store.has(content_hash):
                    misses.setdefault(content_hash, segment)
        miss_items = list(misses.items())
        vectors = await self.embeddings.embed([query] + [text for _, text in miss_items])
        if not vectors or len(vectors) != len(miss_items) + 1:
            raise ValueError("embeddings backend returned mismatched vector count")
        query_vector = vectors[0]
        for (content_hash, _), vector in zip(miss_items, vectors[1:]):
            store.upsert(content_hash, vector, text="")
        if miss_items:
            self._persist(project_id)
        scores: List[float] = []
        for segments, hashes in zip(segment_lists, segment_hashes):
            best = 0.0
            for content_hash in hashes:
                cached = store.get(content_hash)
                if cached:
                    best = max(best, cosine_similarity(query_vector, cached["vector"]))
            scores.append(best)
        return scores

    def _get_store(self, project_id: str, storage: Any) -> VectorStore:
        key = project_id or "_default"
        if key in self._stores:
            return self._stores[key]
        path = None
        getter = getattr(storage, "get_embeddings_cache_path", None)
        if getter is not None and project_id:
            try:
                path = getter(project_id)
            except Exception:
                path = None
        store = VectorStore.load(path) if path else VectorStore()
        self._stores[key] = store
        if path:
            self._paths[key] = path
        return store

    def _persist(self, project_id: str) -> None:
        key = project_id or "_default"
        path = self._paths.get(key)
        store = self._stores.get(key)
        if not path or store is None:
            return
        try:
            store.save(path)
        except Exception as exc:
            logger.warning("Failed to persist embedding cache (%s): %s", path, exc)


class ScoreFusion:
    """Fuse lexical and semantic scores independently of candidate loading."""

    def __init__(self, *, strategy: str, bm25_weight: float, vector_weight: float):
        self.strategy = strategy
        self.bm25_weight = bm25_weight
        self.vector_weight = vector_weight

    def fuse(self, candidates: List[ContextItem], semantic_scores: List[float]) -> Dict[int, float]:
        lexical = [float(item.relevance_score or 0.0) for item in candidates]
        if self.strategy == "weighted":
            left = self.normalize(lexical)
            right = self.normalize(semantic_scores)
            return {
                index: self.bm25_weight * left[index] + self.vector_weight * right[index]
                for index in range(len(candidates))
            }
        lexical_rank = self.ranks(lexical)
        semantic_rank = self.ranks(semantic_scores)
        return {
            index: 1.0 / (RRF_K + lexical_rank[index]) + 1.0 / (RRF_K + semantic_rank[index])
            for index in range(len(candidates))
        }

    @staticmethod
    def ranks(scores: List[float]) -> Dict[int, int]:
        order = sorted(range(len(scores)), key=lambda index: scores[index], reverse=True)
        return {index: position + 1 for position, index in enumerate(order)}

    @staticmethod
    def normalize(scores: List[float]) -> List[float]:
        if not scores:
            return []
        low, high = min(scores), max(scores)
        if high <= low:
            return [0.0 for _ in scores]
        return [(score - low) / (high - low) for score in scores]


class RankingTraceRenderer:
    """Render a stable JSON-safe explanation of one ranking decision."""

    @staticmethod
    def render(
        *,
        query: str,
        candidates: Iterable[ContextItem],
        returned: Iterable[ContextItem],
        fusion: str,
        semantic_enabled: bool,
        semantic_used: bool,
        semantic_degraded: bool,
        reranker_requested: bool,
        rerank_applied: bool,
        reranker_degraded: bool,
        filters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        candidate_rows = list(candidates)
        returned_rows = list(returned)
        return {
            "query": query,
            "fusion": fusion if semantic_used else "lexical",
            "signals": {
                "bm25": True,
                "embedding": semantic_used,
                "rrf": semantic_used and fusion == "rrf",
                "rerank": rerank_applied,
                "chapter_distance": any("introduced_in" in item.metadata for item in candidate_rows),
                "temporal_scope": bool(
                    (filters or {}).get("future_fact_filter_active")
                    or (filters or {}).get("future_text_chunk_filter_active")
                ),
            },
            "filters": dict(filters or {}),
            "semantic_enabled": semantic_enabled,
            "semantic_used": semantic_used,
            "semantic_degraded": semantic_degraded,
            "reranker_requested": reranker_requested,
            "reranker_used": rerank_applied,
            "reranker_degraded": reranker_degraded,
            "candidate_count": len(candidate_rows),
            "returned": len(returned_rows),
            "top_results": [
                {
                    "id": item.id,
                    "type": item.type.value if hasattr(item.type, "value") else str(item.type),
                    "score": round(float(item.relevance_score or 0.0), 6),
                    "lexical_score": round(float(item.metadata.get("_lex", 0.0)), 6),
                    "semantic_score": round(float(item.metadata.get("_sem", 0.0)), 6),
                    "reranker_score": round(float(item.metadata.get("_rerank", 0.0)), 6),
                    "chapter": item.metadata.get("chapter") or item.metadata.get("introduced_in"),
                    "source_type": item.metadata.get("source_type"),
                }
                for item in returned_rows
            ],
        }
