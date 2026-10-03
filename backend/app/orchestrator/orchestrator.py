# -*- coding: utf-8 -*-
"""
文枢 WenShape - 深度上下文感知的智能体小说创作系统
WenShape - Deep Context-Aware Agent-Based Novel Writing System

Copyright © 2025-2026 WenShape Team
License: PolyForm Noncommercial License 1.0.0

模块说明 / Module Description:
  Orchestrator 是单 Writer 写作、显式分析、计划与会话能力的应用门面。
"""

import asyncio
import hashlib
import json
import time
import uuid
from contextlib import nullcontext
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from app.llm_gateway import get_gateway
from app.control_plane.store import RevisionConflict
from app.storage.file_lock import get_file_lock
from app.error_contract import error_envelope, record_degradation, safe_error_code
from app.storage import (
    CardStorage,
    CanonStorage,
    DraftStorage,
    MemoryPackStorage,
    CreativeMemoryStorage,
    PlanStore,
    SessionHistoryStorage,
)
from app.agents import ArchivistAgent, WriterAgent
from app.context_engine.select_engine import ContextSelectEngine
from app.context_engine.embeddings import create_embeddings_backend
from app.context_engine.reranker import create_reranker_backend
from app.context_engine.turn_scope import bind_turn_scope, current_turn_scope, new_turn_scope
from app.orchestrator.storage_adapter import UnifiedStorageAdapter
from app.utils.language import normalize_language
from app.utils.logger import get_logger
from app.orchestrator.contracts import SessionStatus
from app.orchestrator._analysis_mixin import AnalysisMixin
from app.orchestrator.architecture import route_contract
from app.orchestrator.context_planning_service import ContextPlanningService
from app.orchestrator.context_assembly_service import ContextAssemblyService
from app.orchestrator.writing_service import WritingService
from app.services.consistency_annotation_service import ConsistencyAnnotationService
from app.orchestrator.turn_runtime import TurnState
from app.orchestrator.chat_turn_service import ChatTurnService
from app.orchestrator.post_turn_service import PostTurnService
from app.orchestrator.plan_execution_service import PlanExecutionService
from app.orchestrator.worker_task_service import WorkerTaskService
from app.orchestrator.application_ports import (
    AnalysisPort,
    CommandPort,
    ConversationPort,
    OrchestratorApplicationPorts,
    StreamTaskRegistry,
    VolumeSummaryService,
)

logger = get_logger(__name__)


class Orchestrator(AnalysisMixin):
    """
    单 Writer 写作运行时与显式辅助能力的应用门面。

    Attributes:
        card_storage (CardStorage): 角色/世界观卡片存储 / Character and world card storage.
        canon_storage (CanonStorage): 事实表和时间线存储 / Canon facts and timeline events storage.
        draft_storage (DraftStorage): 章节草稿和摘要存储 / Draft and summary storage.
        gateway (LLMGateway): LLM 调用网关 / Unified LLM gateway.
        archivist (ArchivistAgent): 仅供显式分析、摘要等辅助能力内部使用。
        writer (WriterAgent): 默认写作与编辑的唯一 Agent。
        select_engine (ContextSelectEngine): 上下文选择引擎 / Context selection engine.
        progress_callback (Optional[Callable]): 进度更新回调 / Callback for progress updates.
        current_status (SessionStatus): 当前会话状态 / Current session status.
    """

    def __init__(
        self, data_dir: Optional[str] = None, progress_callback: Optional[Callable] = None, language: str = "zh"
    ):
        """
        初始化编排器 / Initialize the Orchestrator.

        Note: Must use consistent path resolution logic with Settings.data_dir
        to avoid data directory misalignment where drafts are written but
        not visible to the frontend status interface.

        Args:
            data_dir: 数据目录路径 / Path to data directory (defaults to Settings.data_dir).
            progress_callback: 进度更新回调函数 / Async callback for progress events.
            language: 写作语言 / Writing language ("zh" or "en").
        """
        if data_dir is None:
            from app.config import settings

            data_dir = settings.data_dir
        self.card_storage = CardStorage(data_dir)
        self.canon_storage = CanonStorage(data_dir)
        self.draft_storage = DraftStorage(data_dir)
        self.memory_pack_storage = MemoryPackStorage(data_dir)
        self.creative_memory_storage = CreativeMemoryStorage(data_dir)
        self.plan_store = PlanStore(data_dir)
        self.session_history = SessionHistoryStorage(data_dir)

        self.gateway = get_gateway()

        normalized_language = normalize_language(language, default="zh")
        self.language = normalized_language
        self.archivist = ArchivistAgent(
            self.gateway,
            self.card_storage,
            self.canon_storage,
            self.draft_storage,
            language=normalized_language,
        )
        self.writer = WriterAgent(
            self.gateway,
            self.card_storage,
            self.canon_storage,
            self.draft_storage,
            language=normalized_language,
        )
        self.storage_adapter = UnifiedStorageAdapter(self.card_storage, self.canon_storage, self.draft_storage)
        # Phase 4: 注入嵌入后端（默认 config.retrieval.embeddings.enabled=true → 语义+词法融合）。
        # 初始化失败（缺库/缺模型）时工厂返回 None，检索自动降级为纯词法，绝不阻断写作主流程。
        try:
            from app.config import config as _app_config

            embeddings_backend = create_embeddings_backend(_app_config)
            reranker_backend = create_reranker_backend(_app_config)
        except Exception as exc:
            logger.warning("Retrieval model backend unavailable; affected capability disabled: %s", exc)
            embeddings_backend = None
            reranker_backend = None
        self.select_engine = ContextSelectEngine(
            embeddings_service=embeddings_backend,
            reranker_service=reranker_backend,
        )
        # Phase 7 降级可见：启动即明示语义检索配置状态（依赖缺失会在首次检索时降级，见 select_engine）。
        if embeddings_backend is not None:
            logger.info("语义检索：已配置启用（嵌入后端就绪；缺 fastembed/模型时首次检索降级为纯词法）。")
        else:
            logger.info("语义检索：纯词法（embeddings.enabled=false 或嵌入后端不可用）。")

        self.progress_callback = progress_callback
        self.current_status = SessionStatus.IDLE
        self.current_project_id: Optional[str] = None
        self.current_chapter: Optional[str] = None
        self.stream_tasks = StreamTaskRegistry()
        self._cancelled: bool = False  # 通用取消标志，用于在所有阶段响应用户取消 / General cancel flag
        self._active_turn_scopes: Dict[str, Any] = {}

        self.worker_task_service = WorkerTaskService()
        self.context_planning_service = ContextPlanningService(
            select_engine=self.select_engine,
            draft_storage=self.draft_storage,
            gateway=self.gateway,
        )
        self.context_assembly_service = ContextAssemblyService(language=self.language)
        self.writing_service = WritingService(
            gateway=self.gateway,
            writer=self.writer,
            draft_storage=self.draft_storage,
            storage_adapter=self.storage_adapter,
            select_engine=self.select_engine,
            context_assembly=self.context_assembly_service,
            progress_callback=self.progress_callback,
            detect_proposals=self._detect_proposals,
            is_cancelled=self._is_cancelled,
            memory_storage=self.creative_memory_storage,
            consistency_service=ConsistencyAnnotationService(self.storage_adapter),
        )
        self.chat_turn_service = ChatTurnService(self)
        self.post_turn_service = PostTurnService(
            session_history=self.session_history,
            archivist=self.archivist,
            creative_memory_storage=self.creative_memory_storage,
            summarize_conversation=self._summarize_conversation,
            verify_compact=self._verify_compact_artifact,
        )
        self.plan_execution_service = PlanExecutionService(
            gateway=self.gateway,
            writer=self.writer,
            draft_storage=self.draft_storage,
            plan_store=self.plan_store,
            select_engine=self.select_engine,
            storage_adapter=self.storage_adapter,
            worker_service=self.worker_task_service,
            emit_progress=self._emit_progress,
            translate=self._p,
            is_cancelled=self._is_cancelled,
            writing_service=self.writing_service,
            analyze_chapter=self.analyze_chapter,
        )
        self.volume_summary_service = VolumeSummaryService(
            draft_storage=self.draft_storage,
            archivist=self.archivist,
        )
        self.application = OrchestratorApplicationPorts(
            conversation=ConversationPort(self.session_history, self.post_turn_service),
            commands=CommandPort(self._run_command),
            analysis=AnalysisPort(self),
            volumes=self.volume_summary_service,
            plans=self.plan_execution_service,
        )

    def set_language(self, language: str) -> None:
        normalized = normalize_language(language, default=self.language)
        if normalized not in {"zh", "en"}:
            return
        self.language = normalized
        try:
            self.archivist.language = normalized
            self.writer.language = normalized
            self.context_assembly_service.set_language(normalized)
        except Exception:
            return

    def set_progress_callback(self, callback: Optional[Callable]) -> None:
        self.progress_callback = callback
        self.writing_service.progress_callback = callback

    async def apply_change_set(self, project_id: str, changes: List[Dict[str, Any]]) -> Dict[str, Any]:
        async with get_file_lock().lock(self.draft_storage.get_project_path(project_id) / ".change_set_transaction"):
            return await self._apply_change_set_locked(project_id, changes)

    async def _apply_change_set_locked(self, project_id: str, changes: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Preflight and apply a multi-asset Agent proposal.

        All revisions are checked before the first write. This prevents a stale
        proposal from partially overwriting newer user edits; writes themselves
        use the storage optimistic-concurrency contracts.
        """
        normalized = [item for item in (changes or []) if isinstance(item, dict)]
        if not normalized:
            return {"success": True, "applied": [], "count": 0}
        identities = [(str(item.get("asset_type") or "").strip(), str(item.get("asset_id") or "").strip()) for item in normalized]
        if len(set(identities)) != len(identities):
            return {"success": False, "reason": "duplicate_change_set_asset"}
        outline = getattr(self.storage_adapter, "outline", None)
        checks: List[Dict[str, Any]] = []
        for item in normalized:
            asset_type = str(item.get("asset_type") or "").strip()
            asset_id = str(item.get("asset_id") or "").strip()
            original = str(item.get("original") or "")
            revised = str(item.get("revised") or "")
            base_revision = int(item.get("base_revision") or 0)
            if asset_type == "outline":
                if asset_id != "outline":
                    return {"success": False, "reason": "invalid_change_set_asset"}
                if outline is None:
                    return {"success": False, "reason": "outline_unavailable"}
                current = await outline.get_outline(project_id)
                if int(current.get("revision") or 0) != base_revision or str(current.get("content") or "") != original:
                    return {"success": False, "reason": "revision_conflict", "asset": "outline"}
            elif asset_type == "chapter" and asset_id:
                current, _ = await self.draft_storage.get_working_text(project_id, asset_id, strict=True)
                revision = self.draft_storage.get_draft_revision(project_id, asset_id)
                if int((revision or {}).get("revision") or 0) != base_revision or str(current or "") != original:
                    return {"success": False, "reason": "revision_conflict", "asset": asset_id}
            else:
                return {"success": False, "reason": "invalid_change_set_asset"}
            checks.append({"asset_type": asset_type, "asset_id": asset_id, "original": original, "revised": revised, "base_revision": base_revision, "chapter_target": item.get("chapter_target")})

        applied: List[Dict[str, Any]] = []
        # 写入意图日志（评估 P7 + D1 恢复协议）：preflight 原子、写入不是——
        # 第二个资产写失败时第一个已落盘。journal 先记录全部意图（含恢复材料：
        # 目标全文 + 基线原文，与意图同事务），逐资产标记终态，使部分应用可查询、
        # 可审计、可经 resume 协议续做。
        # D1 严格语义：journal 配置可用但记录失败 → 不开始该批写入（材料未落盘
        # 就开工意味着部分成功后无法恢复）。初始化失败同样拒绝写入。
        journal_id = ""
        store = self._control_store_for_change_set()
        if store is None:
            return {"success": False, "reason": "write_journal_unavailable", "applied": []}
        if store is not None:
            journal_id = uuid.uuid4().hex
            try:
                scope = current_turn_scope()
                store.record_write_intent(
                    journal_id,
                    project_id,
                    scope.turn_id if scope is not None else "",
                    [
                        {
                            "asset_type": item["asset_type"],
                            "asset_id": item["asset_id"],
                            "base_revision": item["base_revision"],
                            "content_sha256": hashlib.sha256(str(item["revised"] or "").encode("utf-8")).hexdigest(),
                            "revised_content": str(item["revised"] or ""),
                            "original_content": str(item["original"] or ""),
                            "chapter_target": item.get("chapter_target") or {},
                        }
                        for item in checks
                    ],
                )
            except Exception as exc:
                logger.error("change set journal intent failed; refusing to start writes: %s", safe_error_code(exc))
                return {"success": False, "reason": "write_journal_unavailable", "detail": safe_error_code(exc)}
        try:
            for item in checks:
                if item["asset_type"] == "outline":
                    saved = await outline.save_outline(
                        project_id, item["revised"], expected_revision=item["base_revision"], expected_content=item["original"]
                    )
                    applied.append({"asset_type": "outline", "asset_id": "outline", "revision": int(saved.get("revision") or 0)})
                else:
                    chapter = item["asset_id"]
                    await self.draft_storage.save_current_draft(
                        project_id=project_id,
                        chapter=chapter,
                        content=item["revised"],
                        word_count=len(item["revised"]),
                        create_prev_backup=True,
                        expected_revision=item["base_revision"],
                        expected_content=item["original"],
                    )
                    target = item.get("chapter_target") or {}
                    summary = await self.draft_storage.get_chapter_summary(project_id, chapter)
                    title = str(target.get("title") or chapter) if isinstance(target, dict) else chapter
                    if summary is None:
                        from app.schemas.draft import ChapterSummary
                        from app.utils.chapter_id import ChapterIDValidator
                        summary = ChapterSummary(
                            chapter=chapter,
                            volume_id=ChapterIDValidator.extract_volume_id(chapter) or "V1",
                            title=title,
                            word_count=len(item["revised"]),
                        )
                    else:
                        if isinstance(target, dict) and target.get("title"):
                            summary.title = title
                        summary.word_count = len(item["revised"])
                    await self.draft_storage.save_chapter_summary(project_id, summary)
                    revision = self.draft_storage.get_draft_revision(project_id, chapter)
                    applied.append({"asset_type": "chapter", "asset_id": chapter, "revision": int((revision or {}).get("revision") or 0)})
                if journal_id:
                    try:
                        store.mark_write_applied(journal_id, item["asset_type"], item["asset_id"])
                    except Exception as exc:
                        record_degradation("change_set_write_journal", exc)
        except RevisionConflict:
            self._journal_remaining_failed(store, journal_id, checks, applied, "revision_conflict")
            applied = await self._reconcile_written_assets(project_id, checks, applied)
            return {
                "success": False,
                "reason": "revision_conflict",
                "applied": applied,
                "journal_id": journal_id,
                "journalless": journal_id == "",
            }
        except Exception as exc:
            logger.warning("change set apply failed: %s", safe_error_code(exc), exc_info=True)
            self._journal_remaining_failed(store, journal_id, checks, applied, safe_error_code(exc))
            applied = await self._reconcile_written_assets(project_id, checks, applied)
            return {
                "success": False,
                "reason": safe_error_code(exc),
                "applied": applied,
                "journal_id": journal_id,
                "journalless": journal_id == "",
            }
        return {
            "success": True,
            "applied": applied,
            "count": len(applied),
            "journal_id": journal_id,
            "journalless": journal_id == "",
        }

    async def _reconcile_written_assets(self, project_id, checks, completed):
        """失败后按实际文件报告已落盘正文；元数据或 journal 仍可能需要恢复。"""
        written = list(completed)
        done = {(item["asset_type"], item["asset_id"]) for item in written}
        for item in checks:
            if (item["asset_type"], item["asset_id"]) in done:
                continue
            revised = str(item.get("revised", item.get("revised_content", "")) or "")
            row = {
                **item, "revised_content": revised,
                "content_sha256": hashlib.sha256(revised.encode("utf-8")).hexdigest(),
            }
            verification = await self._verify_journal_asset(project_id, row)
            if verification.get("result") == "already_applied":
                written.append({
                    "asset_type": item["asset_type"], "asset_id": item["asset_id"],
                    "revision": verification["disk_revision"], "recovery_pending": True,
                })
        return written

    def _control_store_for_change_set(self):
        """Change set journal 的控制平面 store；不可用时降级为 None（journal 关闭）。

        路径沿用全仓惯例 ``<data_dir>/_system/control.sqlite3``（与
        ``control_plane/runtime.control_database_path``、``source_snapshot._control_store``
        同一落点），但以 **本 Orchestrator 实例的 data_dir** 为根——而不是全局单例的
        settings.data_dir——保证测试中 ``Orchestrator(tmp_path)`` 的 journal 写入
        落在临时目录，不污染真实数据目录。生产环境两者是同一路径；多连接并发
        由 SQLite WAL + busy_timeout 承担（control_plane 原生支持）。
        """
        cached = getattr(self, "_change_set_journal_store", None)
        if cached is not None:
            return cached or None
        try:
            from app.control_plane.store import SQLiteControlStore

            data_dir = str(getattr(self.draft_storage, "data_dir", "") or "").strip()
            if not data_dir:
                self._change_set_journal_store = False
                return None
            path = Path(data_dir) / "_system" / "control.sqlite3"
            store = SQLiteControlStore(path)
            self._change_set_journal_store = store
            return store
        except Exception as exc:
            record_degradation("change_set_write_journal", exc)
            return None

    def change_set_journal_store(self):
        """journal store 的公有只读入口（D1）：供治理/诊断路径读取，不绕过恢复协议。"""
        return self._control_store_for_change_set()

    def _journal_remaining_failed(self, store, journal_id: str, checks: List[Dict[str, Any]], applied: List[Dict[str, Any]], error: str) -> None:
        """把未写完的资产在 journal 中标记为 failed（标记失败本身也只降级）。"""
        if not journal_id or store is None:
            return
        done = {(str(row.get("asset_type") or ""), str(row.get("asset_id") or "")) for row in applied}
        for item in checks:
            key = (str(item["asset_type"] or ""), str(item["asset_id"] or ""))
            if key in done:
                continue
            try:
                store.mark_write_failed(journal_id, key[0], key[1], error)
            except Exception as exc:
                record_degradation("change_set_write_journal", exc)
                return

    # ------------------------------------------------- D1 多资产恢复协议 ----

    async def inspect_change_set_journal(self, project_id: str) -> Dict[str, Any]:
        """恢复预览（D1）：列出未完成 journal 行，逐资产核对磁盘实际状态。

        不写任何内容。每行附核对结论：
        - already_applied：磁盘内容已等于目标（崩溃前实际写成功、journal 未及标记）→ 续做时幂等跳过
        - conflict：磁盘 revision ≠ base_revision（用户中途编辑）→ 续做时停止
        - pending：磁盘仍是基线原文 → 续做时正常写入
        - row_status：journal 自身状态（pending/failed/applied/superseded）
        """
        store = self._control_store_for_change_set()
        if store is None:
            return {"success": True, "journals": [], "journalless": True}
        # 恢复预览展示存在未完成行的 journal 的**全部**资产行（含已应用项）——
        # 用户需要完整图景判断续做影响；全完成的 journal 不出现在入口。
        all_rows = store.journal_rows(project_id)
        journals: Dict[str, Dict[str, Any]] = {}
        unfinished: set = set()
        for row in all_rows:
            journal_id = str(row.get("journal_id") or "")
            if str(row.get("status") or "") in {"pending", "failed"}:
                unfinished.add(journal_id)
        for row in all_rows:
            journal_id = str(row.get("journal_id") or "")
            if journal_id not in unfinished:
                continue
            entry = journals.setdefault(
                journal_id,
                {"journal_id": journal_id, "turn_id": str(row.get("turn_id") or ""), "assets": []},
            )
            verification = await self._verify_journal_asset(project_id, row)
            entry["assets"].append(
                {
                    "asset_type": str(row.get("asset_type") or ""),
                    "asset_id": str(row.get("asset_id") or ""),
                    "status": str(row.get("status") or ""),
                    "error": str(row.get("error") or ""),
                    "base_revision": int(row.get("base_revision") or 0),
                    "original": str(row.get("original_content") or ""),
                    "revised": str(row.get("revised_content") or ""),
                    "check": verification,
                }
            )
        return {"success": True, "journals": list(journals.values()), "journalless": False}

    async def _verify_journal_asset(self, project_id: str, row: Dict[str, Any]) -> Dict[str, Any]:
        """核对一行 journal 与磁盘实际内容/revision 的关系（只读）。"""
        asset_type = str(row.get("asset_type") or "")
        asset_id = str(row.get("asset_id") or "")
        revised = str(row.get("revised_content") or "")
        base_revision = int(row.get("base_revision") or 0)
        target_sha = str(row.get("content_sha256") or "")
        if not target_sha or hashlib.sha256(revised.encode("utf-8")).hexdigest() != target_sha:
            return {"result": "error", "reason": "recovery_material_invalid"}
        try:
            if asset_type == "outline":
                outline = getattr(self.storage_adapter, "outline", None)
                if outline is None:
                    return {"result": "error", "reason": "outline_unavailable"}
                current = await outline.get_outline(project_id)
                disk_content = str(current.get("content") or "")
                disk_revision = int(current.get("revision") or 0)
            elif asset_type == "chapter":
                disk_content, _ = await self.draft_storage.get_working_text(project_id, asset_id, strict=True)
                disk_content = str(disk_content or "")
                disk_revision = int((self.draft_storage.get_draft_revision(project_id, asset_id) or {}).get("revision") or 0)
            else:
                return {"result": "error", "reason": "invalid_asset_type"}
        except Exception as exc:
            return {"result": "error", "reason": safe_error_code(exc)}
        if target_sha and hashlib.sha256(disk_content.encode("utf-8")).hexdigest() == target_sha:
            # 磁盘已是目标内容：上次写入实际成功（journal 标记失败或崩溃在标记前）。
            return {"result": "already_applied", "disk_revision": disk_revision}
        if disk_revision != base_revision or disk_content != str(row.get("original_content") or ""):
            # 基线已漂移：用户（或其他 turn）在本批写入后改过该资产 → 续做冲突。
            return {"result": "conflict", "disk_revision": disk_revision, "base_revision": base_revision}
        return {"result": "pending", "disk_revision": disk_revision, "base_revision": base_revision}

    async def resume_change_set(self, project_id: str, journal_id: str) -> Dict[str, Any]:
        # 与首次应用、放弃共用跨进程锁；等待中的旧请求必须重读最新 journal 状态。
        async with get_file_lock().lock(self.draft_storage.get_project_path(project_id) / ".change_set_transaction"):
            return await self._resume_change_set_locked(project_id, journal_id)

    async def _resume_change_set_locked(self, project_id: str, journal_id: str) -> Dict[str, Any]:
        """续做协议（D1）：幂等恢复一个 journal 的未完成资产。

        逐资产语义（显式部分成功，不承诺跨文件原子性、不自动回滚）：
        - journal 行 applied / 磁盘已等于目标 → 幂等跳过
        - 磁盘 revision ≠ base_revision → 该资产冲突，**停止**（不继续后续资产）
        - 否则按 journal 材料写入（expected_revision 乐观锁），标记 applied
        - journal 不存在 / 无未完成行 → 明确报告 no_pending
        """
        store = self._control_store_for_change_set()
        if store is None:
            return {"success": False, "reason": "write_journal_unavailable"}
        if not journal_id:
            return {"success": False, "reason": "journal_not_found"}
        rows = store.journal_rows(project_id, journal_id=journal_id)
        if not rows:
            return {"success": False, "reason": "journal_not_found"}
        if any(row["status"] == "superseded" for row in rows):
            return {"success": False, "reason": "journal_superseded"}
        pending_rows = [row for row in rows if row["status"] in {"pending", "failed"}]
        if not pending_rows:
            return {"success": True, "resumed": [], "skipped": len(rows), "reason": "all_applied"}
        resumed: List[Dict[str, Any]] = []
        skipped = len(rows) - len(pending_rows)
        # 先核对全部资产（含已完成项）；作者修改任一资产后不部分续做旧提案。
        for row in rows:
            verification = await self._verify_journal_asset(project_id, row)
            if verification.get("result") in {"conflict", "error"}:
                reason = "resume_revision_conflict" if verification["result"] == "conflict" else verification["reason"]
                return {"success": False, "reason": reason, "asset": row["asset_id"], "resumed": [], "skipped": skipped}
        for row in pending_rows:
            asset_type = str(row.get("asset_type") or "")
            asset_id = str(row.get("asset_id") or "")
            revised = str(row.get("revised_content") or "")
            base_revision = int(row.get("base_revision") or 0)
            verification = await self._verify_journal_asset(project_id, row)
            if verification.get("result") == "conflict":
                self._journal_remaining_failed(store, journal_id, [row], [], "resume_revision_conflict")
                return {
                    "success": False,
                    "reason": "resume_revision_conflict",
                    "asset": asset_id,
                    "resumed": resumed,
                    "skipped": skipped,
                    "disk_revision": verification.get("disk_revision"),
                    "base_revision": base_revision,
                }
            if verification.get("result") == "error":
                self._journal_remaining_failed(store, journal_id, [row], [], str(verification.get("reason") or "verify_error"))
                return {
                    "success": False,
                    "reason": str(verification.get("reason") or "verify_error"),
                    "asset": asset_id,
                    "resumed": resumed,
                    "skipped": skipped,
                }
            # pending：按材料写入（乐观锁；写入与 journal 标记之间崩溃时重恢复可幂等收敛）。
            try:
                already_written = verification.get("result") == "already_applied"
                expected_content = revised if already_written else str(row.get("original_content") or "")
                expected_revision = int(verification["disk_revision"]) if already_written else base_revision
                if asset_type == "outline":
                    outline = getattr(self.storage_adapter, "outline", None)
                    if outline is None:
                        raise ValueError("outline_unavailable")
                    saved = await outline.save_outline(
                        project_id, revised, expected_revision=expected_revision, expected_content=expected_content
                    )
                    revision = int(saved.get("revision") or 0)
                elif asset_type == "chapter":
                    await self.draft_storage.save_current_draft(
                        project_id=project_id,
                        chapter=asset_id,
                        content=revised,
                        word_count=len(revised),
                        create_prev_backup=True,
                        expected_revision=expected_revision,
                        expected_content=expected_content,
                    )
                    revision = int((self.draft_storage.get_draft_revision(project_id, asset_id) or {}).get("revision") or 0)
                    from app.schemas.draft import ChapterSummary
                    from app.utils.chapter_id import ChapterIDValidator

                    target = json.loads(row.get("chapter_target_json") or "{}")
                    summary = await self.draft_storage.get_chapter_summary(project_id, asset_id)
                    if summary is None:
                        summary = ChapterSummary(
                            chapter=asset_id, volume_id=ChapterIDValidator.extract_volume_id(asset_id) or "V1",
                            title=str(target.get("title") or asset_id), word_count=len(revised),
                        )
                    else:
                        if target.get("title"):
                            summary.title = str(target["title"])
                        summary.word_count = len(revised)
                    await self.draft_storage.save_chapter_summary(project_id, summary)
                else:
                    raise ValueError("invalid_asset_type")
                if already_written:
                    skipped += 1
                else:
                    resumed.append({"asset_type": asset_type, "asset_id": asset_id, "revision": revision})
                store.mark_write_applied(journal_id, asset_type, asset_id)
            except RevisionConflict:
                self._journal_remaining_failed(store, journal_id, [row], [], "resume_revision_conflict")
                resumed = await self._reconcile_written_assets(project_id, [row], resumed)
                return {
                    "success": False,
                    "reason": "resume_revision_conflict",
                    "asset": asset_id,
                    "resumed": resumed,
                    "skipped": skipped,
                }
            except Exception as exc:
                self._journal_remaining_failed(store, journal_id, [row], [], safe_error_code(exc))
                resumed = await self._reconcile_written_assets(project_id, [row], resumed)
                return {
                    "success": False,
                    "reason": safe_error_code(exc),
                    "asset": asset_id,
                    "resumed": resumed,
                    "skipped": skipped,
                }
        return {"success": True, "resumed": resumed, "skipped": skipped, "count": len(resumed)}

    async def discard_change_set_journal(self, project_id: str, journal_id: str) -> Dict[str, Any]:
        async with get_file_lock().lock(self.draft_storage.get_project_path(project_id) / ".change_set_transaction"):
            return self._discard_change_set_journal_locked(project_id, journal_id)

    def _discard_change_set_journal_locked(self, project_id: str, journal_id: str) -> Dict[str, Any]:
        """放弃续做（D1）：未完成行标记 superseded（材料保留审计，不再参与恢复入口）。"""
        store = self._control_store_for_change_set()
        if store is None:
            return {"success": False, "reason": "write_journal_unavailable"}
        rows = store.journal_rows(project_id, journal_id=journal_id)
        if not rows:
            return {"success": False, "reason": "journal_not_found"}
        superseded = store.mark_journal_superseded(journal_id)
        return {"success": True, "superseded": superseded}

    def _p(self, zh: str, en: str) -> str:
        return en if self.language == "en" else zh

    def _is_cancelled(self) -> bool:
        """Resolve cancellation from the current turn before the legacy session flag."""

        scope = current_turn_scope()
        if scope is not None:
            return bool(scope.cancelled or scope.runtime.cancelled)
        return self._cancelled

    async def _update_status(self, status: SessionStatus, message: str) -> None:
        """Update session status and notify callback."""
        self.current_status = status

        if self.progress_callback:
            await self.progress_callback(
                {
                    "status": status.value,
                    "message": message,
                    "project_id": self.current_project_id,
                    "chapter": self.current_chapter,
                    "iteration": 0,
                }
            )

    async def _handle_error(self, error_message: str, *, exc: Exception | None = None) -> Dict[str, Any]:
        """Handle error and update status."""
        resolved = exc or RuntimeError("orchestrator_error")
        envelope = error_envelope(resolved)
        logger.error(
            "Orchestrator operation failed: code=%s internal_message=%s",
            safe_error_code(resolved),
            error_message,
            exc_info=exc is not None,
        )

        self.current_status = SessionStatus.ERROR

        if self.progress_callback:
            await self.progress_callback(
                {
                    "status": SessionStatus.ERROR.value,
                    "message": envelope.safe_detail,
                    "error": envelope.to_dict(),
                    "project_id": self.current_project_id,
                    "chapter": self.current_chapter,
                }
            )

        return {"success": False, "status": SessionStatus.ERROR, "error": envelope.to_dict()}

    async def _handle_cancelled(self) -> Dict[str, Any]:
        """Handle user-initiated cancellation: reset state and broadcast cancel event."""
        logger.info("Session cancelled by user: project=%s chapter=%s", self.current_project_id, self.current_chapter)
        self.current_status = SessionStatus.IDLE
        chapter = self.current_chapter
        self.current_project_id = None
        self.current_chapter = None

        if self.progress_callback:
            await self.progress_callback(
                {
                    "type": "cancelled",
                    "status": SessionStatus.IDLE.value,
                    "message": "Session cancelled by user",
                    "project_id": self.current_project_id,
                    "chapter": chapter,
                }
            )

        return {"success": False, "status": SessionStatus.IDLE, "cancelled": True}

    async def decide_writing_action(
        self,
        project_id: str,
        chapter: str,
        message: str,
        *,
        has_selection: bool = False,
        has_draft: bool = False,
        emit: bool = True,
    ) -> Dict[str, Any]:
        """Phase 5（vibe writing）：判定本轮 chat 意图（write/edit）并发透明 intent 事件。

        让前端只需一个输入框：撰写/编辑由此处自判（选中→编辑、无草稿→撰写、含糊→LLM 判定）。
        返回 ``{action, scope, reason, via}``，调用方据此路由到既有 Writer/Editor 能力。
        """
        from app.agents.intent import classify_writing_intent

        try:
            provider = self.gateway.get_provider_for_agent(self.writer.get_agent_name())
        except Exception:
            provider = None
        decision = await classify_writing_intent(
            message,
            has_selection=has_selection,
            has_draft=has_draft,
            gateway=self.gateway,
            provider=provider,
        )
        if emit and self.progress_callback:
            await self.progress_callback({"type": "intent", "project_id": project_id, "chapter": chapter, **decision})
        return decision

    # ---------------------------------------------------------------- 对话记忆层 --
    # 持久化对话历史（Git-Native）+ compact 长对话压缩 + 顺带提炼作者偏好 → creative_memory。
    # 取代脆弱的前端 localStorage 单点：刷新/重启/清缓存/换机均不丢，且可 Git 追踪。

    # 摘要分块：单块上限与块数上限（B3，F08——旧实现 text[:6000] 静默丢弃尾部，
    # artifact 的来源 hash 却覆盖完整 source，验证输入与摘要输入覆盖不一致）。
    _COMPACT_SUMMARY_CHUNK_CHARS = 6000
    _COMPACT_SUMMARY_MAX_CHUNKS = 10

    async def _summarize_conversation(self, text: str) -> Dict[str, Any]:
        """Build CompactArtifactV2 sections; safely degrade to a recoverable summary.

        输入覆盖完整性（B3）：超出单块上限的对话分块提炼、逐块输出合并——
        任何部分都不会在摘要输入处静默丢失。
        """
        text = str(text or "").strip()
        if not text:
            return {}
        chunks: List[str] = []
        limit = self._COMPACT_SUMMARY_CHUNK_CHARS
        for start in range(0, len(text), limit):
            chunks.append(text[start : start + limit])
            if len(chunks) >= self._COMPACT_SUMMARY_MAX_CHUNKS:
                # 块数封顶：保留头部块 + 最后一块（尾部约束/未决事项最关键），中间显式标注省略。
                if start + limit < len(text):
                    chunks.append(text[-limit:])
                    chunks.insert(-1, f"…（中段 {len(text) - start - 2 * limit} 字符分块已达上限，未参与提炼）…")
                break
        merged: Dict[str, Any] = {}
        try:
            provider = self.gateway.get_provider_for_agent(self.archivist.get_agent_name())
            for index, chunk in enumerate(chunks):
                section_note = (
                    f"（第 {index + 1}/{len(chunks)} 块）"
                    if len(chunks) > 1
                    else ""
                )
                system = self._p(
                    "你是创作会话状态压缩器。只输出 JSON 对象，字段固定为 decisions、constraints、entity_state、"
                    "open_loops（字符串数组）和 recent_summary（字符串）。只保留输入明确支持的内容；不推断新事实，"
                    "不把助手建议当作作者决定，不遗漏仍生效的硬约束和未决事项。recent_summary 不超过 300 字。",
                    "You compress writing-session state. Return one JSON object with decisions, constraints, entity_state, "
                    "open_loops (string arrays), and recent_summary (string). Include only source-supported claims; do not "
                    "turn assistant suggestions into user decisions. Preserve active constraints and unresolved work.",
                )
                user_content = f"{section_note}\n{chunk}" if section_note else chunk
                messages = [{"role": "system", "content": system}, {"role": "user", "content": user_content}]
                scope = current_turn_scope()
                if scope is not None and scope.source_closure_required:
                    scope.register_provider_payload(
                        messages,
                        source_prefix=f"orchestrator.compact_summary.chunk{index}",
                        selection_reason="conversation_compact_assembly",
                        artifact_ref="Orchestrator._summarize_conversation",
                    )
                resp = await self.gateway.chat(
                    messages,
                    provider=provider,
                    temperature=0.3,
                    response_format={"type": "json_object"},
                )
                out = str(resp.get("content") or "").strip()
                if not out:
                    continue
                from app.utils.llm_output import parse_json_payload

                parsed, error = parse_json_payload(out, expected_type=dict)
                if not parsed or error:
                    continue
                parsed.pop("_provenance", None)
                if index == 0:
                    merged = parsed
                    merged["_provenance"] = {
                        "provider": str(resp.get("provider") or provider or ""),
                        "model": str(resp.get("model") or ""),
                        "prompt_fingerprint": str(resp.get("request_fingerprint") or ""),
                        "chunked_input": len(chunks) > 1,
                        "chunks_processed": 1,
                    }
                else:
                    for key in ("decisions", "constraints", "entity_state", "open_loops"):
                        values = parsed.get(key)
                        if isinstance(values, list) and values:
                            merged.setdefault(key, [])
                            merged[key] = list(merged[key]) + [v for v in values if v not in merged[key]]
                    summary_part = str(parsed.get("recent_summary") or "").strip()
                    if summary_part:
                        merged["recent_summary"] = (
                            str(merged.get("recent_summary") or "").strip() + f"\n（续）{summary_part}"
                        ).strip()
                    merged["_provenance"]["chunks_processed"] = index + 1
            if merged:
                return merged
        except Exception as exc:
            logger.warning("conversation summary via LLM failed; falling back to rule-based: %s", exc)
        try:
            from app.context_engine.smart_compressor import smart_compress

            compressed, _ = smart_compress(text, target_ratio=0.35)
            return {"recent_summary": str(compressed or "").strip() or text[:600]}
        except Exception:
            return {"recent_summary": text[:600]}

    _COMPACT_VERIFY_CHUNK_CHARS = 60000
    _COMPACT_VERIFY_MAX_CHUNKS = 8

    async def _verify_compact_artifact(self, artifact: Any, source_messages: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Use an independent reviewer profile to reject lossy or unsupported compact state.

        验证覆盖完整性（B3，F08）：超出单块上限的来源分块独立验证，全部块通过才算
        通过——不再用 ``source[:60000]`` 让尾部内容逃过验证（artifact 的来源 hash
        却覆盖完整 source）。
        """
        from app.utils.llm_output import parse_json_payload

        provider = self.gateway.get_provider_for_agent(self.writer.get_agent_name())
        source = "\n".join(
            f"{item.get('role', 'user')}: {str(item.get('content') or '').strip()}"
            for item in source_messages
            if str(item.get("content") or "").strip()
        )
        chunk_limit = self._COMPACT_VERIFY_CHUNK_CHARS
        if len(source) <= chunk_limit:
            chunks = [source]
        else:
            step = max(chunk_limit, -(-len(source) // self._COMPACT_VERIFY_MAX_CHUNKS))
            chunks = [source[i : i + step] for i in range(0, len(source), step)]

        all_unsupported: List[str] = []
        all_omissions: List[str] = []
        all_contradictions: List[str] = []
        last_meta: Dict[str, Any] = {}
        for index, chunk in enumerate(chunks):
            payload = {
                "source_chunk": f"{index + 1}/{len(chunks)}",
                "source_conversation": chunk,
                "compact_artifact": artifact.to_dict(),
                "criteria": {
                    "unsupported_claims": "artifact claims absent from source",
                    "severe_omissions": "missing active hard constraints, decisions, entity state, or open loops",
                    "contradictions": "artifact conflicts with source",
                },
            }
            messages = [
                {
                    "role": "system",
                    "content": (
                        "你是独立的会话压缩审计器。只输出 JSON：unsupported_claims、severe_omissions、"
                        "contradictions（字符串数组）及 valid（布尔值）。只有三个数组均为空时 valid 才为 true。"
                        "不要评价文风，不要补充来源中不存在的信息。"
                    ),
                },
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
            ]
            scope = current_turn_scope()
            if scope is not None and scope.source_closure_required:
                scope.register_provider_payload(
                    messages,
                    source_prefix=f"orchestrator.compact_verify.chunk{index}",
                    selection_reason="compact_verifier_assembly",
                    artifact_ref="Orchestrator._verify_compact_artifact",
                )
            response = await self.gateway.chat(
                messages,
                provider=provider,
                temperature=0.0,
                max_tokens=800,
                response_format={"type": "json_object"},
            )
            parsed, error = parse_json_payload(str(response.get("content") or ""), expected_type=dict)
            if error or not parsed:
                return {"available": True, "valid": False, "reason": "invalid_verifier_response", "error": error}
            unsupported = [str(item) for item in parsed.get("unsupported_claims") or [] if str(item).strip()]
            omissions = [str(item) for item in parsed.get("severe_omissions") or [] if str(item).strip()]
            contradictions = [str(item) for item in parsed.get("contradictions") or [] if str(item).strip()]
            all_unsupported.extend(unsupported)
            all_omissions.extend(omissions)
            all_contradictions.extend(contradictions)
            last_meta = {
                "provider": response.get("provider") or provider,
                "model": response.get("model"),
                "request_fingerprint": response.get("request_fingerprint"),
            }
            # 任一块出现严重遗漏/矛盾即提前失败——后续块无需再验。
            if omissions or contradictions:
                break
        valid = not all_unsupported and not all_omissions and not all_contradictions
        return {
            "available": True,
            "valid": valid,
            "unsupported_claims": all_unsupported,
            "severe_omissions": all_omissions,
            "contradictions": all_contradictions,
            "chunks_verified": len(chunks),
            **last_meta,
        }

    async def run_chat_turn(
        self,
        project_id: str,
        chapter: str,
        message: str,
        *,
        conversation_id: str = "",
        has_selection: bool = False,
        has_draft: bool = False,
        target_word_count: int = 3000,
        auto_execute_plan: bool = False,
        thinking: bool = False,
        reasoning_level: str = "auto",
        selection_text: str = "",
        request_id: str = "",
        selection: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Delegate the main route to ChatTurnService."""

        return await self.chat_turn_service.run(
            project_id,
            chapter,
            message,
            conversation_id=conversation_id,
            has_selection=has_selection,
            has_draft=has_draft,
            target_word_count=target_word_count,
            auto_execute_plan=auto_execute_plan,
            thinking=thinking,
            reasoning_level=reasoning_level,
            selection_text=selection_text,
            request_id=request_id,
            selection=selection,
        )

    def _cancel_active_turns(self) -> int:
        """Cancel every active turn owned by this project orchestrator."""

        scopes = list(self._active_turn_scopes.values())
        for scope in scopes:
            scope.cancel()
        self._cancelled = True
        return len(scopes)

    def cancel_session(self) -> Dict[str, int]:
        """Cancel all turn scopes and active stream tasks, then reset session state."""
        turns = self._cancel_active_turns()
        streams = self.stream_tasks.cancel_all()
        self.current_status = SessionStatus.IDLE
        self.current_project_id = None
        self.current_chapter = None
        return {"turns": turns, "streams": streams}

    async def _run_command(
        self,
        *,
        project_id: str,
        chapter: str,
        intent: str,
        route_path: str,
        operation: Callable[[], Any],
        target_word_count: int = 3000,
        conversation_id: str = "",
    ) -> Any:
        """Execute an explicit application operation under the shared turn control plane."""

        existing = current_turn_scope()
        owns_scope = existing is None
        scope = existing or new_turn_scope(project_id=project_id, chapter_id=chapter)
        if owns_scope:
            # 会话身份显式传递：不因执行期间活动会话切换而读到其他会话的 epoch（A2）。
            scope.context_epoch = await self.session_history.current_context_epoch(
                project_id, conversation_id=conversation_id
            )
        if owns_scope:
            self._active_turn_scopes[scope.turn_id] = scope
        try:
            with bind_turn_scope(scope) if owns_scope else nullcontext(scope):
                if scope.runtime.state == TurnState.CREATED:
                    scope.runtime.transition(TurnState.ROUTING)
                if scope.runtime.state == TurnState.ROUTING:
                    scope.runtime.transition(TurnState.CONTEXT_PLANNING, metadata={"intent": intent})
                self.context_planning_service.prepare_context_plan(
                    scope=scope,
                    project_id=project_id,
                    chapter=chapter,
                    intent=intent,
                    route_path=route_path,
                    target_word_count=target_word_count,
                )
                result = operation()
                if route_path == "plan_workflow" and scope.runtime.state == TurnState.CONTEXT_PLANNING:
                    scope.runtime.transition(TurnState.PLAN_RUNNING)
                elif route_path == "agentic_writer" and scope.runtime.state == TurnState.CONTEXT_PLANNING:
                    scope.runtime.transition(TurnState.WRITER_RUNNING)
                elif scope.runtime.state == TurnState.CONTEXT_PLANNING:
                    scope.runtime.transition(TurnState.WORKER_RUNNING, metadata={"route": route_path})
                if asyncio.iscoroutine(result):
                    result = await result
                if owns_scope and isinstance(result, dict):
                    result.setdefault("route_contract", route_contract(intent))
                    result = await self.context_planning_service.attach_chat_context_plan(
                        result,
                        project_id=project_id,
                        chapter=chapter,
                        intent=intent,
                        target_word_count=target_word_count,
                    )
                if owns_scope:
                    scope.runtime.complete()
                    if isinstance(result, dict):
                        result["runtime"] = scope.runtime.to_dict()
                return result
        except asyncio.CancelledError:
            scope.runtime.cancel("task_cancelled")
            raise
        except Exception as exc:
            scope.runtime.fail(exc)
            raise
        finally:
            if owns_scope:
                self._active_turn_scopes.pop(scope.turn_id, None)

    async def _emit_progress(self, message: str, **kwargs) -> None:
        if not self.progress_callback:
            return
        status = kwargs.pop("status", "research")
        payload = {
            "status": status,
            "message": message,
            "project_id": self.current_project_id,
            "chapter": self.current_chapter,
            "timestamp": int(time.time() * 1000),
        }
        for key, value in kwargs.items():
            if value is not None:
                payload[key] = value
        await self.progress_callback(payload)
