# -*- coding: utf-8 -*-
"""
文枢 WenShape - 深度上下文感知的智能体小说创作系统
WenShape - Deep Context-Aware Agent-Based Novel Writing System

Copyright © 2025-2026 WenShape Team
License: PolyForm Noncommercial License 1.0.0

模块说明 / Module Description:
  编排器分析Mixin - 章节分析、事实表持久化和卡片创建
  AnalysisMixin - Chapter analysis, canon persistence, and card-creation methods.
  Extracted from orchestrator.py, injected back via Mixin inheritance.
  所有方法通过 self 访问 Orchestrator 的 storage / agent / select_engine 等属性。
"""

import hashlib
import re
from typing import Any, Dict, List, Optional

from app.schemas.canon import Fact, TimelineEvent, CharacterState
from app.schemas.draft import ChapterSummary
from app.schemas.card import StyleCard
from app.utils.chapter_id import ChapterIDValidator, normalize_chapter_id
from app.error_contract import safe_error_code
from app.utils.logger import get_logger
from app.orchestrator.contracts import SessionStatus
from app.agents.turn_effects import normalize_turn_effect, validated_fact_candidates

logger = get_logger(__name__)


class AnalysisMixin:
    """
    编排器分析Mixin - 章节分析、事实表持久化和卡片创建

    Provides methods for analyzing chapter content, extracting canonical facts,
    updating character states, detecting proposals, and managing card creation.
    Supports batch operations for efficient multi-chapter processing.
    """

    @staticmethod
    def _normalize_fact_statement(value: Any) -> str:
        return re.sub(r"[\s\W_]+", "", str(value or "")).casefold()

    async def _persist_fact_candidates(
        self,
        project_id: str,
        candidates: List[Any],
        *,
        chapter: str,
        source_ref: str,
        default_status: str = "needs_review",
    ) -> Dict[str, int]:
        """唯一事实写入 owner：统一去重、编号、状态与出处绑定。"""

        existing = await self.canon_storage.get_all_facts_raw(project_id)
        existing_ids = {str(item.get("id") or "") for item in existing}
        statements = {
            self._normalize_fact_statement(item.get("statement") or item.get("content")) for item in existing
        }
        statements.discard("")
        next_index = 1
        for fact_id in existing_ids:
            match = re.match(r"^F(\d+)$", fact_id, re.IGNORECASE)
            if match:
                next_index = max(next_index, int(match.group(1)) + 1)

        saved = 0
        deduplicated = 0
        for raw in candidates:
            if hasattr(raw, "model_dump"):
                data = raw.model_dump(exclude_none=True)
            elif isinstance(raw, dict):
                data = dict(raw)
            else:
                continue
            statement = str(data.get("statement") or data.get("content") or "").strip()
            normalized = self._normalize_fact_statement(statement)
            if not normalized or normalized in statements:
                deduplicated += 1
                continue
            requested_id = str(data.get("id") or "")
            if not requested_id or requested_id in existing_ids:
                while f"F{next_index:04d}" in existing_ids:
                    next_index += 1
                requested_id = f"F{next_index:04d}"
                next_index += 1
            evidence = str(data.pop("evidence", "") or "").strip()
            evidence_refs = list(data.get("evidence_refs") or [])
            if evidence:
                evidence_hash = hashlib.sha256(evidence.encode("utf-8")).hexdigest()
                evidence_refs.append(f"chapter:{chapter}#sha256:{evidence_hash}")
                data.setdefault("context_prefix", f"证据：{evidence[:240]}")
            source_refs = list(data.get("source_refs") or [])
            if source_ref and source_ref not in source_refs:
                source_refs.append(source_ref)
            fact = Fact(
                **{
                    **data,
                    "id": requested_id,
                    "statement": statement,
                    "source": data.get("source") or chapter,
                    "introduced_in": data.get("introduced_in") or chapter,
                    "status": data.get("status") or default_status,
                    "confidence_method": data.get("confidence_method") or "model_declared",
                    "source_refs": source_refs,
                    "evidence_refs": evidence_refs,
                }
            )
            await self.canon_storage.add_fact(project_id, fact)
            existing_ids.add(requested_id)
            statements.add(normalized)
            saved += 1
        return {"saved": saved, "deduplicated": deduplicated}

    def _resolve_volume_id_from_analysis(self, chapter: str, analysis: Dict[str, Any]) -> str:
        """
        从分析结果中最好地解析volume_id / Best-effort resolve volume_id for batching volume summary refresh.

        在批量保存/同步时，为避免每章都触发一次分卷摘要（LLM 调用），这里提前收集 volume_id，
        最终按卷统一刷新一次即可。

        During batch save/sync, pre-collect volume_ids to avoid triggering a volume summary
        LLM call for each chapter. Instead, refresh once per volume at the end.

        Args:
            chapter: 章节ID / Chapter identifier.
            analysis: 分析结果字典 / Analysis result dictionary.

        Returns:
            分卷ID，默认 'V1' / Volume ID (defaults to 'V1').
        """
        if isinstance(analysis, dict):
            summary = analysis.get("summary") or {}
            if isinstance(summary, dict):
                volume_id = str(summary.get("volume_id") or "").strip()
                if volume_id:
                    return volume_id
        normalized = normalize_chapter_id(chapter)
        return ChapterIDValidator.extract_volume_id(normalized) or "V1"

    async def analyze_chapter(
        self,
        project_id: str,
        chapter: str,
        content: Optional[str] = None,
        chapter_title: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        手动触发章节分析（不持久化） / Manually trigger analysis for a chapter (no persistence).

        Analyzes chapter content to extract summaries, canonical facts, timeline events,
        and character states. Returns analysis payload without saving to storage.

        Args:
            project_id: 项目ID / Project identifier.
            chapter: 章节ID / Chapter identifier.
            content: 章节内容 / Chapter content (optional, loads from draft if not provided).
            chapter_title: 章节标题 / Chapter title (optional).

        Returns:
            Analysis result dict with 'success' flag and 'analysis' payload.
        """
        try:
            draft_content = content or ""
            if not draft_content:
                working_text, working_path = await self.draft_storage.get_working_text(project_id, chapter)
                if working_path is None:
                    return {"success": False, "error": "No draft found"}
                if not working_text:
                    return {"success": False, "error": "Draft content missing"}
                draft_content = working_text

            self.current_project_id = project_id
            self.current_chapter = chapter
            await self._update_status(SessionStatus.GENERATING_BRIEF, "Analyzing content...")

            analysis = await self._build_analysis(
                project_id=project_id,
                chapter=chapter,
                content=draft_content,
                chapter_title=chapter_title,
            )

            await self._update_status(SessionStatus.IDLE, "Analysis completed.")
            return {"success": True, "analysis": analysis}
        except Exception as exc:
            return await self._handle_error("Analysis failed", exc=exc)

    async def apply_turn_effect(self, project_id: str, chapter: str, turn_effect: Dict[str, Any]) -> Dict[str, Any]:
        """Validate and persist the single Writer Agent's accepted turn effect without another LLM call."""
        normalized_chapter = normalize_chapter_id(chapter)
        content, working_path = await self.draft_storage.get_working_text(project_id, normalized_chapter)
        if working_path is None or not str(content or "").strip():
            return {"success": False, "reason": "draft_missing"}
        effect = normalize_turn_effect(turn_effect)
        change_type = str(effect.get("change_type") or "conversation")
        operation = str(effect.get("fact_operation") or "none")
        candidates = validated_fact_candidates(effect, content)
        rejected_evidence = max(0, len(list(effect.get("fact_candidates") or [])) - len(candidates))
        existing_summary = await self.draft_storage.get_chapter_summary(project_id, normalized_chapter)
        summary_updated = False
        if change_type in {"chapter_write", "plot_edit"} and str(effect.get("chapter_summary") or "").strip():
            summary = existing_summary or ChapterSummary(
                chapter=normalized_chapter,
                volume_id=ChapterIDValidator.extract_volume_id(normalized_chapter) or "V1",
                title=normalized_chapter,
            )
            summary.brief_summary = str(effect.get("chapter_summary") or "").strip()
            summary.word_count = len(content)
            summary.new_facts = [str(item.get("statement") or "") for item in candidates]
            await self.draft_storage.save_chapter_summary(project_id, summary)
            summary_updated = True

        if operation == "replace_chapter":
            await self.canon_storage.delete_unconfirmed_generated_facts_by_chapter(project_id, normalized_chapter)

        facts_saved = 0
        facts_deduplicated = 0
        if operation != "none":
            persisted = await self._persist_fact_candidates(
                project_id,
                candidates,
                chapter=normalized_chapter,
                source_ref=f"writer_turn:{normalized_chapter}",
            )
            facts_saved = persisted["saved"]
            facts_deduplicated = persisted["deduplicated"]

        try:
            from app.services.chapter_binding_service import chapter_binding_service

            await chapter_binding_service.build_bindings(project_id, normalized_chapter, force=True)
        except Exception as exc:
            logger.warning("Failed to refresh bindings after accepted-content sync: %s", exc)

        return {
            "success": True,
            "applied": summary_updated or facts_saved > 0 or operation == "replace_chapter",
            "chapter": normalized_chapter,
            "change_type": change_type,
            "fact_operation": operation,
            "summary_updated": summary_updated,
            "stats": {
                "facts_saved": facts_saved,
                "facts_rejected_evidence": rejected_evidence,
                "facts_deduplicated": facts_deduplicated,
            },
        }

    async def _build_analysis(
        self,
        project_id: str,
        chapter: str,
        content: str,
        chapter_title: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        构建分析载荷（摘要、事实、建议）不持久化 / Build analysis payload (summary, facts, proposals) without persisting.

        Calls archivist to generate chapter summaries, extract canonical updates,
        and detect proposals. Combines results into comprehensive analysis.

        Args:
            project_id: 项目ID / Project identifier.
            chapter: 章节ID / Chapter identifier.
            content: 章节内容文本 / Chapter content text.
            chapter_title: 章节标题 / Chapter title (optional).

        Returns:
            Analysis payload with summary, facts, timeline events, states, and proposals.
        """
        scene_brief = await self.draft_storage.get_scene_brief(project_id, chapter)
        title = chapter_title or (scene_brief.title if scene_brief and scene_brief.title else chapter)

        summary = await self.archivist.generate_chapter_summary(
            project_id=project_id,
            chapter=chapter,
            chapter_title=title,
            final_draft=content,
        )
        volume_id = summary.volume_id or ChapterIDValidator.extract_volume_id(chapter) or "V1"
        summary_data = summary.model_dump()
        summary_data["chapter"] = chapter
        summary_data["volume_id"] = volume_id
        summary_data["word_count"] = len(content)
        if not summary_data.get("title"):
            summary_data["title"] = title
        summary = ChapterSummary(**summary_data)

        canon_updates = await self.archivist.extract_canon_updates(
            project_id=project_id,
            chapter=chapter,
            final_draft=content,
        )

        facts = canon_updates.get("facts", []) or []
        if len(facts) > 5:
            facts = facts[:5]

        return {
            "summary": summary.model_dump(),
            "facts": [fact.model_dump() for fact in facts],
            "timeline_events": [event.model_dump() for event in canon_updates.get("timeline_events", []) or []],
            "character_states": [state.model_dump() for state in canon_updates.get("character_states", []) or []],
            "relations": list(canon_updates.get("relations", []) or []),
            # Auto card creation has been removed from analysis flow.
            "proposals": [],
        }

    async def analyze_sync(self, project_id: str, chapters: List[str]) -> Dict[str, Any]:
        """
        批量分析和覆盖选定章节的摘要/事实/卡片 / Batch analyze and overwrite summaries/facts/cards for selected chapters.

        Performs full analysis pipeline for multiple chapters including:
        - Building analysis payload (summary, facts, timeline, character states)
        - Saving analysis to storage (with overwrite option)
        - Building chapter bindings with focus character detection
        - Refreshing volume summaries

        Args:
            project_id: 项目ID / Project identifier.
            chapters: 章节ID列表 / List of chapter identifiers.

        Returns:
            Batch result dict with per-chapter status and statistics.
        """
        results = []
        # Keep caller-selected chapter order stable to avoid UI reorder surprises.
        chapter_list = [str(ch).strip() for ch in (chapters or []) if str(ch).strip()]
        chapters = list(dict.fromkeys(chapter_list))
        total = len(chapters)
        completed = 0
        volume_ids_to_refresh: List[str] = []

        async def emit_progress(message: str) -> None:
            if not self.progress_callback:
                return
            await self.progress_callback(
                {
                    "status": "sync",
                    "message": message,
                    "project_id": project_id,
                }
            )

        if total == 0:
            return {"success": True, "results": []}

        chapter_list = [str(ch).strip() for ch in (chapters or []) if str(ch).strip()]
        chapters = list(dict.fromkeys(chapter_list))
        for chapter in chapters:
            try:
                completed += 1
                await emit_progress(f"同步分析中 ({completed}/{total})：{chapter}")
                working_text, working_path = await self.draft_storage.get_working_text(project_id, chapter)
                if working_path is None:
                    results.append({"chapter": chapter, "success": False, "error": "No draft found"})
                    continue
                if not working_text:
                    results.append({"chapter": chapter, "success": False, "error": "Draft content missing"})
                    continue
                analysis = await self._build_analysis(
                    project_id=project_id,
                    chapter=chapter,
                    content=working_text,
                    chapter_title=None,
                )
                await emit_progress(f"同步保存中 ({completed}/{total})：{chapter}")
                volume_ids_to_refresh.append(self._resolve_volume_id_from_analysis(chapter, analysis))
                save_result = await self.save_analysis(
                    project_id=project_id,
                    chapter=chapter,
                    analysis=analysis,
                    overwrite=True,
                    rebuild_volume_summary=False,
                )
                bindings_result = {"bindings_built": False}
                try:
                    from app.services.chapter_binding_service import chapter_binding_service

                    await emit_progress(f"同步绑定中 ({completed}/{total})：{chapter}")
                    focus_characters: List[str] = []
                    try:
                        focus_characters = await self.archivist.bind_focus_characters(
                            project_id=project_id,
                            chapter=chapter,
                            final_draft=working_text,
                            limit=5,
                        )
                    except Exception as exc:
                        bindings_result["focus_error"] = safe_error_code(exc)

                    base_binding = await chapter_binding_service.build_bindings(project_id, chapter, force=True)
                    if focus_characters:
                        base_binding["characters"] = focus_characters
                        base_binding["focus_characters"] = focus_characters
                        base_binding["binding_method"] = "llm_focus"
                    else:
                        base_binding["binding_method"] = base_binding.get("binding_method") or "algorithmic"

                    await chapter_binding_service.write_bindings(project_id, chapter, base_binding)
                    bindings_result["bindings_built"] = True
                    bindings_result["binding_method"] = base_binding.get("binding_method")
                    bindings_result["focus_characters"] = focus_characters
                except Exception as exc:
                    bindings_result["bindings_error"] = safe_error_code(exc)
                # 将 analysis 一并返回给前端，用于批量同步后展示/校对“事实/摘要”等分析内容。
                # 注意：此处 analysis 已经持久化（save_analysis），前端若二次编辑可通过 save-analysis-batch 覆盖写入。
                results.append({"chapter": chapter, "analysis": analysis, **save_result, **bindings_result})
            except Exception as exc:
                results.append({"chapter": chapter, "success": False, "error": safe_error_code(exc)})

        await emit_progress("同步收尾：刷新分卷摘要...")
        await self.volume_summary_service.refresh(project_id, volume_ids_to_refresh)
        await emit_progress("同步完成")
        return {"success": True, "results": results}

    async def analyze_batch(self, project_id: str, chapters: List[str]) -> Dict[str, Any]:
        """
        批量分析章节并返回分析载荷 / Batch analyze chapters and return analysis payload.

        Analyzes multiple chapters without persisting results. Useful for previewing
        analysis before committing via save_analysis_batch.

        Args:
            project_id: 项目ID / Project identifier.
            chapters: 章节ID列表 / List of chapter identifiers.

        Returns:
            Batch result dict with per-chapter analysis payload.
        """
        results = []
        for chapter in chapters:
            try:
                working_text, working_path = await self.draft_storage.get_working_text(project_id, chapter)
                if working_path is None:
                    results.append({"chapter": chapter, "success": False, "error": "No draft found"})
                    continue
                if not working_text:
                    results.append({"chapter": chapter, "success": False, "error": "Draft content missing"})
                    continue
                analysis = await self._build_analysis(
                    project_id=project_id,
                    chapter=chapter,
                    content=working_text,
                    chapter_title=None,
                )
                results.append({"chapter": chapter, "success": True, "analysis": analysis})
            except Exception as exc:
                results.append({"chapter": chapter, "success": False, "error": safe_error_code(exc)})

        return {"success": True, "results": results}

    async def save_analysis_batch(
        self,
        project_id: str,
        items: List[Dict[str, Any]],
        overwrite: bool = False,
    ) -> Dict[str, Any]:
        """
        持久化分析载荷批次 / Persist analysis payload batch.

        Saves multiple analysis payloads to storage at once. Optionally overwrites
        existing facts and settings. Batches volume summary refresh for efficiency.

        Args:
            project_id: 项目ID / Project identifier.
            items: 分析项列表，每项包含 'chapter' 和 'analysis' / List of items with 'chapter' and 'analysis'.
            overwrite: 覆盖现有数据 / Overwrite existing facts and cards.

        Returns:
            Batch result dict with per-item status and overall success flag.
        """
        results = []
        volume_ids_to_refresh: List[str] = []
        for item in items:
            chapter = item.get("chapter")
            analysis = item.get("analysis", {}) if isinstance(item, dict) else {}
            if not chapter:
                results.append({"chapter": "", "success": False, "error": "Missing chapter"})
                continue
            try:
                volume_ids_to_refresh.append(
                    self._resolve_volume_id_from_analysis(str(chapter), analysis if isinstance(analysis, dict) else {})
                )
                result = await self.save_analysis(
                    project_id=project_id,
                    chapter=chapter,
                    analysis=analysis,
                    overwrite=overwrite,
                    rebuild_volume_summary=False,
                )
                results.append({"chapter": chapter, **result})
            except Exception as exc:
                results.append({"chapter": chapter, "success": False, "error": safe_error_code(exc)})
        await self.volume_summary_service.refresh(project_id, volume_ids_to_refresh)
        return {"success": True, "results": results}

    async def save_analysis(
        self,
        project_id: str,
        chapter: str,
        analysis: Dict[str, Any],
        overwrite: bool = False,
        rebuild_volume_summary: bool = False,
    ) -> Dict[str, Any]:
        """
        持久化分析输出（摘要、事实、卡片） / Persist analysis output (summary, facts, cards).

        Saves chapter analysis including summaries, canonical facts, timeline events,
        and character states to storage. Optionally creates cards from proposals.
        Volume summary rebuild is off by default for speed; callers that need it
        (e.g. _analyze_content, _refresh_volume_summaries) enable it explicitly.

        Args:
            project_id: 项目ID / Project identifier.
            chapter: 章节ID / Chapter identifier.
            analysis: 分析载荷 / Analysis result dictionary.
            overwrite: 覆盖现有数据 / Overwrite existing facts and settings.
            rebuild_volume_summary: 重建分卷摘要（默认关闭以加速保存） / Rebuild volume summary (off by default for speed).

        Returns:
            Save result dict with success flag and statistics.
        """
        try:
            summary_data = analysis.get("summary", {}) or {}
            summary_data["chapter"] = normalize_chapter_id(summary_data.get("chapter") or chapter)
            existing_summary = await self.draft_storage.get_chapter_summary(project_id, summary_data["chapter"])
            if existing_summary:
                # Preserve manual chapter ordering and stable metadata during analysis overwrite.
                if summary_data.get("order_index") is None:
                    summary_data["order_index"] = existing_summary.order_index
                if not summary_data.get("volume_id"):
                    summary_data["volume_id"] = existing_summary.volume_id
                if not summary_data.get("title"):
                    summary_data["title"] = existing_summary.title
            summary = ChapterSummary(**summary_data)
            summary.new_facts = []
            if not summary.volume_id:
                summary.volume_id = ChapterIDValidator.extract_volume_id(summary.chapter) or "V1"
            if not summary.title:
                summary.title = chapter

            await self.draft_storage.save_chapter_summary(project_id, summary)

            if rebuild_volume_summary:
                volume_summaries = await self.draft_storage.list_chapter_summaries(
                    project_id,
                    volume_id=summary.volume_id,
                )
                volume_summary = await self.archivist.generate_volume_summary(
                    project_id=project_id,
                    volume_id=summary.volume_id,
                    chapter_summaries=volume_summaries,
                )
                await self.draft_storage.volume_storage.save_volume_summary(project_id, volume_summary)

            facts_saved = 0
            timeline_saved = 0
            states_saved = 0

            # Overwrite: normalize + delete in a single read-write pass
            if overwrite:
                await self.canon_storage.delete_and_normalize_by_chapter(project_id, summary.chapter)
                # 同步清掉本章旧关系边，避免重新分析时重复 append（关系图为 append-only）。
                try:
                    await self.canon_storage.delete_relations_by_chapter(project_id, summary.chapter)
                except Exception as exc:
                    logger.warning("Failed to clear chapter relations on overwrite: %s", exc)

            facts_input = analysis.get("facts", []) or []
            if len(facts_input) > 5:
                facts_input = facts_input[:5]
            persisted = await self._persist_fact_candidates(
                project_id,
                facts_input,
                chapter=summary.chapter,
                source_ref=f"chapter_analysis:{summary.chapter}",
            )
            facts_saved = persisted["saved"]

            for item in analysis.get("timeline_events", []) or []:
                event_data = item if isinstance(item, dict) else {}
                event_data = {**event_data, "source": event_data.get("source") or chapter}
                await self.canon_storage.add_timeline_event(project_id, TimelineEvent(**event_data))
                timeline_saved += 1

            for item in analysis.get("character_states", []) or []:
                state_data = item if isinstance(item, dict) else {}
                if not state_data.get("character"):
                    continue
                state_data = {**state_data, "last_seen": state_data.get("last_seen") or chapter}
                await self.canon_storage.update_character_state(project_id, CharacterState(**state_data))
                states_saved += 1

            # Phase 4: 顺手把角色关系沉淀为关系图边（无额外 LLM 调用）。
            # 来源：① 角色状态的 relationships 字段派生；② 分析载荷里显式提供的 relations（前向兼容）。
            relations_saved = 0
            try:
                derived = self.canon_storage.derive_relations_from_states(
                    analysis.get("character_states", []) or [], summary.chapter
                )
                explicit = [r for r in (analysis.get("relations", []) or []) if isinstance(r, dict)]
                relations_saved = await self.canon_storage.add_relations(project_id, derived + explicit)
            except Exception as exc:
                logger.warning("Failed to persist relation edges: %s", exc)

            return {
                "success": True,
                "stats": {
                    "facts_saved": facts_saved,
                    "timeline_saved": timeline_saved,
                    "states_saved": states_saved,
                    "relations_saved": relations_saved,
                    "cards_created": 0,
                },
            }
        except Exception as exc:
            return await self._handle_error("Analysis save failed", exc=exc)

    async def _analyze_content(self, project_id: str, chapter: str, content: str):
        """
        运行后期草稿分析（摘要 + 事实表更新） / Run post-draft analysis (summaries + canon updates).

        Called after user confirms a chapter draft. Generates summaries at chapter
        and volume levels, extracts and persists canonical facts.

        Args:
            project_id: 项目ID / Project identifier.
            chapter: 章节ID / Chapter identifier.
            content: 最终草稿内容 / Final draft content text.
        """
        try:
            normalized_chapter = normalize_chapter_id(chapter)
            scene_brief = await self.draft_storage.get_scene_brief(project_id, chapter)
            chapter_title = scene_brief.title if scene_brief and scene_brief.title else chapter

            summary = await self.archivist.generate_chapter_summary(
                project_id=project_id,
                chapter=normalized_chapter,
                chapter_title=chapter_title,
                final_draft=content,
            )
            summary.chapter = normalized_chapter
            await self.draft_storage.save_chapter_summary(project_id, summary)

            volume_id = ChapterIDValidator.extract_volume_id(normalized_chapter) or "V1"
            volume_summaries = await self.draft_storage.list_chapter_summaries(project_id, volume_id=volume_id)
            volume_summary = await self.archivist.generate_volume_summary(
                project_id=project_id,
                volume_id=volume_id,
                chapter_summaries=volume_summaries,
            )
            await self.draft_storage.volume_storage.save_volume_summary(project_id, volume_summary)
        except Exception as exc:
            logger.warning("Failed to generate summaries: %s", exc)

        try:
            canon_updates = await self.archivist.extract_canon_updates(
                project_id=project_id,
                chapter=normalized_chapter,
                final_draft=content,
            )

            await self._persist_fact_candidates(
                project_id,
                list(canon_updates.get("facts", []) or []),
                chapter=normalized_chapter,
                source_ref=f"chapter_analysis:{normalized_chapter}",
            )

            for event in canon_updates.get("timeline_events", []) or []:
                await self.canon_storage.add_timeline_event(project_id, event)

            for state in canon_updates.get("character_states", []) or []:
                await self.canon_storage.update_character_state(project_id, state)

            # Phase 4: 顺手沉淀关系图边（无额外 LLM 调用）。
            # 来源：① 档案员显式抽取的 relations 三元组；② 角色状态 relationships 派生。
            try:
                explicit = list(canon_updates.get("relations", []) or [])
                derived = self.canon_storage.derive_relations_from_states(
                    canon_updates.get("character_states", []) or [], normalized_chapter
                )
                await self.canon_storage.add_relations(project_id, explicit + derived)
            except Exception as exc:
                logger.warning("Failed to persist relation edges: %s", exc)

            try:
                report = await self.canon_storage.detect_conflicts(
                    project_id=project_id,
                    chapter=chapter,
                    new_facts=canon_updates.get("facts", []) or [],
                    new_timeline_events=canon_updates.get("timeline_events", []) or [],
                    new_character_states=canon_updates.get("character_states", []) or [],
                )
                # Phase 6：关系一致性护栏（确定性、无 LLM）—— 把"关系前后矛盾且无演变标注"并入报告。
                try:
                    rel_issues = await self.canon_storage.detect_relation_inconsistencies(project_id)
                    if rel_issues:
                        report.setdefault("conflicts", []).extend(rel_issues)
                except Exception as exc:
                    logger.warning("Relation consistency check failed: %s", exc)
                await self.draft_storage.save_conflict_report(
                    project_id=project_id,
                    chapter=chapter,
                    report=report,
                )
            except Exception as exc:
                logger.warning("Failed to detect conflicts: %s", exc)
        except Exception as exc:
            logger.warning("Failed to update canon: %s", exc)

        # Phase 10：定稿后提炼跨会话创作记忆（偏好/进度/决策）→ 写 memory（best-effort，不阻断收尾）。
        try:
            await self._extract_and_store_memory(project_id, normalized_chapter, content)
        except Exception as exc:
            logger.warning("Creative memory extraction failed: %s", exc)

    async def _extract_and_store_memory(
        self,
        project_id: str,
        chapter: str,
        final_draft: str,
        user_feedback: str = "",
    ) -> int:
        """Phase 10 · 提炼并写入跨会话创作记忆；返回写入条数（best-effort，异常不外抛）。"""
        summary_text = ""
        try:
            summary = await self.draft_storage.get_chapter_summary(project_id, chapter)
            summary_text = str(getattr(summary, "summary", "") or "") if summary else ""
        except Exception:
            summary_text = ""

        items = await self.archivist.extract_creative_memory(
            final_draft=final_draft,
            user_feedback=user_feedback,
            chapter_summary=summary_text,
        )
        written = 0
        for item in items:
            description = str(item.get("description") or "").strip()
            if not description:
                continue
            try:
                await self.creative_memory_storage.write_candidate_memory(
                    project_id,
                    slug=item.get("slug") or description[:24],
                    description=description,
                    body=item.get("body", ""),
                    mem_type=item.get("type", "preference"),
                    source=f"chapter_finalize:{chapter}",
                    confidence=0.6,
                )
                written += 1
            except Exception as exc:
                logger.warning("Write creative memory failed: %s", exc)
        return written

    async def _detect_proposals(self, project_id: str, content: Any) -> List[Dict]:
        """
        从内容检测设定建议 / Detect setting proposals from content.

        Calls archivist to identify new characters, world settings, and other
        entities mentioned in the draft. Filters proposals by type to match
        product requirements (e.g., character creation may be disabled).

        Args:
            project_id: 项目ID / Project identifier.
            content: 草稿内容对象或文本 / Draft content object or text.

        Returns:
            设定建议列表 / List of setting proposal dicts.
        """
        # Product decision: disable auto proposal generation in analysis flow entirely.
        return []

    async def extract_style_profile(self, project_id: str, sample_text: str) -> StyleCard:
        """
        从示例文本提取写作风格指导 / Extract writing style guidance from sample text.

        Calls archivist to analyze writing style and return a StyleCard
        for consistent voice across the project.

        Args:
            project_id: 项目ID / Project identifier.
            sample_text: 示例文本 / Sample text to analyze.

        Returns:
            写作风格卡片 / StyleCard object with style guidance.
        """
        style_text = await self.archivist.extract_style_profile(sample_text)
        return StyleCard(style=style_text)
