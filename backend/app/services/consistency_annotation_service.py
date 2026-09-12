# -*- coding: utf-8 -*-
"""
文枢 WenShape - 深度上下文感知的智能体小说创作系统
WenShape - Deep Context-Aware Agent-Based Novel Writing System

Copyright © 2025-2026 WenShape Team
License: PolyForm Noncommercial License 1.0.0

模块说明 / Module Description:
  Change set 一致性标注（评估 P4）：提案生成后、作者审阅前，对每个章节资产的
  revised 文本做**确定性**的相关性提示标注——正文触及的既有 canon 事实、
  涉及双人且带称呼设定的对白句。标注是提示性的（advisory）：不修改 original/
  revised、不阻断采纳/拒绝、不参与 revision preflight；作者仍是唯一决策者。

  明确不做语义矛盾判定（那需要 LLM/NLI，属独立能力扩张）：本服务只提供
  「请核对」信号，把「系统保证上下文来源可验证」延伸到「提示产出与既有
  事实的潜在冲突面」。无 LLM、无新 Agent、无网络。

Consistency annotation for change sets: deterministic, advisory-only hints
attached to each chapter proposal before author review.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List

from app.context_engine.relation_graph import Relation
from app.context_engine.text_tokenizer import tokenize
from app.utils.chapter_id import ChapterIDValidator
from app.utils.logger import get_logger

logger = get_logger(__name__)

# 每个资产最多输出的标注条数；超限以一条汇总标注显式表达（不静默截断）。
_MAX_ANNOTATIONS_PER_ASSET = 3
# 事实相关判定的最小独立 token 命中数（长度 ≥2 的分词 token）。
_MIN_TOKEN_HITS = 2
# 称呼检查的句界切分与对白标记。
_SENTENCE_SPLIT_RE = re.compile(r"[。！？\n]")
_DIALOGUE_MARKERS = ("「", "『", "“", "\"", "：")


class ConsistencyAnnotationService:
    """Deterministic advisory annotations for change set proposals.

    单一 owner：change set 一致性标注只在这里产生。输入是已组装的 proposal
    列表（就地附加 ``consistency_annotations`` 字段），输出无返回值——标注
    失败一律降级（record_degradation），绝不破坏 change set 主路径。
    """

    def __init__(self, storage_adapter: Any):
        self.adapter = storage_adapter

    async def annotate_change_set(self, project_id: str, change_set: List[Dict[str, Any]]) -> None:
        """对 change set 中每个章节资产附加提示性一致性标注（就地、非阻断）。"""
        try:
            chapter_items = [
                item
                for item in (change_set or [])
                if isinstance(item, dict) and str(item.get("asset_type") or "") == "chapter" and str(item.get("asset_id") or "")
            ]
            if not chapter_items:
                return
            facts = await self._eligible_facts(project_id)
            edges = await self._card_edges(project_id)
            if not facts and not edges:
                return
            for item in chapter_items:
                self._annotate_chapter(item, facts, edges)
        except Exception as exc:
            # 标注是观测性增强：任何失败都不允许影响 change set 的组装与交付。
            from app.error_contract import record_degradation

            record_degradation("consistency_annotation", exc)

    # ------------------------------------------------------------------
    # 数据加载 / Data loading
    # ------------------------------------------------------------------

    async def _eligible_facts(self, project_id: str) -> List[Any]:
        try:
            getter = getattr(self.adapter, "get_eligible_facts", None)
            if getter is None:
                return []
            return list(await getter(project_id) or [])
        except Exception as exc:
            logger.warning("consistency annotation fact load degraded: %s", type(exc).__name__)
            return []

    async def _card_edges(self, project_id: str) -> List[Relation]:
        try:
            get_edges = getattr(self.adapter, "get_card_relation_edges", None)
            if get_edges is None:
                return []
            return [
                Relation.from_card_edge(edge)
                for edge in (await get_edges(project_id) or [])
                if isinstance(edge, dict)
            ]
        except Exception as exc:
            logger.warning("consistency annotation edge load degraded: %s", type(exc).__name__)
            return []

    # ------------------------------------------------------------------
    # 标注规则 / Annotation rules
    # ------------------------------------------------------------------

    def _annotate_chapter(self, item: Dict[str, Any], facts: List[Any], edges: List[Relation]) -> None:
        revised = str(item.get("revised") or "")
        if not revised.strip():
            return
        asset_chapter = str(item.get("asset_id") or "")
        annotations: List[Dict[str, Any]] = []

        # 规则 1：正文触及的既有事实（eligible + as-of 过滤）→ 「请核对一致性」。
        # introduced_in 等于本章的事实是本轮自己的抽取对象，跳过以免自指噪声。
        for fact in facts:
            statement = str(getattr(fact, "statement", "") or "").strip()
            if not statement:
                continue
            introduced_in = str(getattr(fact, "introduced_in", "") or "").strip()
            if not introduced_in or introduced_in == asset_chapter:
                continue
            # as-of 语义：写作时点之后才确立的事实不在核对范围（与检索侧同口径）。
            if asset_chapter and ChapterIDValidator.is_after(introduced_in, asset_chapter):
                continue
            if self._fact_tokens_hit(statement, revised):
                annotations.append(
                    {
                        "kind": "related_fact",
                        "source": f"canon:{getattr(fact, 'id', '') or ''}",
                        "statement": statement[:80],
                        "note": f"本章正文涉及既有事实「{statement[:40]}…」（{introduced_in} 确立），请在采纳前核对是否一致。",
                    }
                )

        # 规则 2：双人同现且含对白的句子未使用设定称呼 → 提示称呼核对。
        # 保守触发：仅当句子同时含两个角色名与对白标记、且该句未出现任一设定称呼。
        for edge in edges:
            if not (edge.subject and edge.object and (edge.appellation or edge.reverse_appellation)):
                continue
            annotation = self._appellation_annotation(edge, revised)
            if annotation:
                annotations.append(annotation)

        if not annotations:
            return
        # 超限显式汇总：不静默截断（与目录/关系边推送同一铁律）。
        remaining = max(0, len(annotations) - _MAX_ANNOTATIONS_PER_ASSET)
        annotations = annotations[:_MAX_ANNOTATIONS_PER_ASSET]
        item.setdefault("consistency_annotations", [])
        existing = item["consistency_annotations"]
        for annotation in annotations:
            if annotation not in existing:
                existing.append(annotation)
        if remaining > 0:
            existing.append({"kind": "more", "source": "consistency", "statement": "", "note": f"另有 {remaining} 条潜在相关项未逐条标注。"})
        item["consistency_annotations"] = existing

    @staticmethod
    def _fact_tokens_hit(statement: str, revised: str) -> bool:
        """事实 statement 的实质 token 是否有足量命中正文（词法确定性判定）。"""
        tokens = {token for token in tokenize(statement, remove_stopwords=True) if len(token) >= 2}
        if not tokens:
            return False
        hits = sum(1 for token in tokens if token in revised)
        return hits >= _MIN_TOKEN_HITS

    @staticmethod
    def _appellation_annotation(edge: Relation, revised: str) -> Dict[str, Any] | None:
        for sentence in _SENTENCE_SPLIT_RE.split(revised):
            sentence = sentence.strip()
            if not sentence or not any(marker in sentence for marker in _DIALOGUE_MARKERS):
                continue
            if edge.subject not in sentence or edge.object not in sentence:
                continue
            # 句中双人同现且有对白，但设定称呼一个都没出现 → 提示核对。
            if edge.appellation and edge.appellation in sentence:
                return None
            if edge.reverse_appellation and edge.reverse_appellation in sentence:
                return None
            return {
                "kind": "appellation",
                "source": "cards/relations.yaml",
                "statement": f"{edge.subject} —[{edge.relation}]→ {edge.object}",
                "note": (
                    f"「{sentence[:40]}…」句中 {edge.subject} 与 {edge.object} 同现且含对白，"
                    "但未使用作者设定的称呼，请在采纳前核对称呼是否与关系设定一致。"
                ),
            }
        return None
