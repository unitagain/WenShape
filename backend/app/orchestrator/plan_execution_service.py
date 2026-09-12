# -*- coding: utf-8 -*-
"""Plan execution service.

P7 抽离点：Plan 创建、串行执行、断点续传和低风险 research worker。
"""

from __future__ import annotations

import time
from typing import Any, Awaitable, Callable, Dict, Optional

from app.agents.planner import generate_plan
from app.error_contract import safe_error_code
from app.orchestrator.worker_task_service import WorkerTaskService
from app.utils.logger import get_logger

logger = get_logger(__name__)

ProgressCallback = Callable[..., Awaitable[None]]
TextCallback = Callable[[str, str], str]
CancelledCallback = Callable[[], bool]
StepRunner = Callable[[str, Dict[str, Any]], Awaitable[str]]
ChapterAnalyzer = Callable[[str, str], Awaitable[Dict[str, Any]]]


class PlanExecutionService:
    """Create and execute serial writing plans."""

    def __init__(
        self,
        *,
        gateway: Any,
        writer: Any,
        draft_storage: Any,
        plan_store: Any,
        select_engine: Any,
        storage_adapter: Any,
        worker_service: WorkerTaskService,
        emit_progress: ProgressCallback,
        translate: TextCallback,
        is_cancelled: CancelledCallback,
        writing_service: Any,
        analyze_chapter: ChapterAnalyzer,
    ):
        self.gateway = gateway
        self.writer = writer
        self.draft_storage = draft_storage
        self.plan_store = plan_store
        self.select_engine = select_engine
        self.storage_adapter = storage_adapter
        self.worker_service = worker_service
        self.emit_progress = emit_progress
        self.translate = translate
        self.is_cancelled = is_cancelled
        self.writing_service = writing_service
        self.analyze_chapter = analyze_chapter

    async def create_plan(self, project_id: str, goal: str, context_hint: str = "") -> Optional[Dict[str, Any]]:
        """Split a complex instruction into a persisted serial plan."""

        try:
            provider = self.gateway.get_provider_for_agent(self.writer.get_agent_name())
        except Exception:
            provider = None
        try:
            existing_chapters = await self.draft_storage.list_chapters(project_id)
        except Exception:
            existing_chapters = []
        steps = await generate_plan(self.gateway, provider, goal, context_hint, chapters=existing_chapters)
        if not steps:
            return None
        plan = {
            "id": f"plan_{int(time.time() * 1000)}",
            "goal": str(goal or "").strip(),
            "steps": steps,
            "status": "planning",
            "created_at": int(time.time() * 1000),
        }
        await self.plan_store.write_plan(project_id, plan)
        await self.emit_progress(
            self.translate("已生成执行计划", "Plan generated"),
            stage="plan_created",
            status="plan",
            project_id=project_id,
            plan_id=plan["id"],
            steps=len(steps),
        )
        return plan

    async def execute_plan(
        self, project_id: str, plan_id: str, step_runner: Optional[StepRunner] = None
    ) -> Dict[str, Any]:
        """Execute a plan serially with per-step persistence."""

        plan = await self.plan_store.read_plan(project_id, plan_id)
        if not plan:
            return {"success": False, "error": "plan_not_found"}
        runner = step_runner or self.run_plan_step
        steps = plan.get("steps") or []
        plan["status"] = "running"
        await self.plan_store.write_plan(project_id, plan)

        completed = True
        for step in steps:
            if self.is_cancelled():
                completed = False
                break
            if step.get("status") == "done":
                continue
            await self.emit_progress(
                self.translate(
                    f"计划步骤 {step.get('id')}/{len(steps)}：{step.get('description', '')}",
                    f"Plan step {step.get('id')}/{len(steps)}: {step.get('description', '')}",
                ),
                stage="plan_step",
                status="plan",
                # U9：必须显式带 project_id。`_emit_progress` 默认取 orchestrator 的
                # `current_project_id`，而本服务经 HTTP `/session/plan/{id}/execute` 调用时
                # 该字段为 None（只有 run_chat_turn 路径会设置），导致 `_progress_callback`
                # 直接 return——逐步进度事件全部被静默丢弃，前端只能在 HTTP 返回时
                # 一次性刷成「全部完成」。
                project_id=project_id,
                step_id=step.get("id"),
                action=step.get("action"),
            )
            try:
                result = await runner(project_id, step)
                step["status"] = "done"
                if result:
                    step["result"] = str(result)[:500]
            except Exception as exc:
                step["status"] = "failed"
                step["error"] = safe_error_code(exc)
                logger.warning("Plan step %s failed: %s", step.get("id"), exc)
                completed = False
                await self.plan_store.write_plan(project_id, plan)
                await self._emit_step_done(step, total=len(steps), project_id=project_id)
                break
            await self.plan_store.write_plan(project_id, plan)
            await self._emit_step_done(step, total=len(steps), project_id=project_id)

        if self.is_cancelled():
            plan["status"] = "interrupted"
        elif completed:
            plan["status"] = "done"
        else:
            plan["status"] = "failed"
        await self.plan_store.write_plan(project_id, plan)
        return {"success": completed, "plan": plan}

    async def _emit_step_done(self, step: Dict[str, Any], *, total: int, project_id: str) -> None:
        """Emit one step's terminal metadata so the task card can advance live.

        只发元数据：资产 ID 与字符增减量。正文、prompt 一律不进 WS payload（§4 不变量），
        diff 内容由 `execute_plan` 的 HTTP 响应（plan.steps[].change_set）交付前端。
        """

        assets = [
            {
                "asset_type": str(item.get("asset_type") or ""),
                "asset_id": str(item.get("asset_id") or ""),
                "original_chars": len(str(item.get("original") or "")),
                "revised_chars": len(str(item.get("revised") or "")),
            }
            for item in (step.get("change_set") or [])
            if isinstance(item, dict)
        ]
        await self.emit_progress(
            self.translate(
                f"计划步骤 {step.get('id')}/{total} 已{'完成' if step.get('status') == 'done' else '失败'}",
                f"Plan step {step.get('id')}/{total} {step.get('status')}",
            ),
            stage="plan_step_done",
            status="plan",
            project_id=project_id,
            step_id=step.get("id"),
            step_status=step.get("status"),
            terminal_state=step.get("terminal_state"),
            iterations=step.get("iterations"),
            error_code=step.get("error"),
            assets=assets or None,
        )

    async def run_plan_step(self, project_id: str, step: Dict[str, Any]) -> str:
        """Dispatch one plan step to the single Writer path."""

        action = str(step.get("action") or "").strip()
        chapter = str(step.get("chapter") or "").strip()
        description = str(step.get("description") or "").strip()

        if action == "research":
            return f"research: {await self.research_note(project_id, description)}"

        if action in ("edit", "analyze") and chapter:
            try:
                existing = await self.draft_storage.list_chapters(project_id)
            except Exception:
                existing = []
            if existing and chapter not in existing:
                raise ValueError(f"章节 {chapter} 不存在，无法 {action}")

        # write 允许 chapter 为空：新建章节由 Writer 在该步内调用 create_chapter 定目标。
        if action == "write":
            return await self._run_writing_step(project_id, step, chapter, description, action)
        if action == "edit" and chapter:
            return await self._run_writing_step(project_id, step, chapter, description, action)
        if action == "analyze" and chapter:
            result = await self.analyze_chapter(project_id, chapter)
            return f"analyze {chapter}: {result.get('success')}"
        if action in ("edit", "analyze"):
            # U9：edit/analyze 缺 chapter 时必须显式失败。此前会落到下方兜底 return，
            # 步骤被标记 done 却什么都没写——正是「未正常工作、后端无报错」这一类静默失败
            # （对齐 §4「incomplete 不伪装 completed」「不静默吞关键异常」）。
            raise ValueError(f"{action}_step_missing_chapter")
        return f"{action}: {description[:80]}"

    async def _run_writing_step(
        self,
        project_id: str,
        step: Dict[str, Any],
        chapter: str,
        description: str,
        action: str,
    ) -> str:
        """Execute one writing step through the Writer path and stage its proposals.

        U9：不再直接 `save_current_draft`。U8 已确立「所有写入先形成 proposal/diff、
        不得静默落盘」，但该不变量此前未覆盖 plan 路径（旧实现每步直接写盘）。
        这里把每步的 change_set 挂到 step 上——`execute_plan` 会逐步持久化并随
        `plan_step` 事件下发，由作者在任务卡内逐项采纳，采纳仍走既有 apply-change-set
        （原子 revision 校验，唯一 owner）。

        turn_effect 同样不在此应用：不能从作者尚未采纳的正文里抽取 canon 事实。
        每步记录 iterations 与终态，供任务卡展示与截断诊断。
        """

        result = await self.writing_service.run(project_id, chapter, description)
        agent_run = result.get("agent_run")
        if isinstance(agent_run, dict):
            step["iterations"] = int(agent_run.get("iterations") or 0)
        change_set = result.get("change_set") or result.get("proposals") or []
        step["change_set"] = [item for item in change_set if isinstance(item, dict)]
        terminal_state = str(result.get("terminal_state") or "").strip()
        if not result.get("success") or not result.get("changed"):
            state = terminal_state or str(result.get("reason") or "") or "incomplete"
            step["terminal_state"] = state
            return f"{action} {chapter}: {state}"
        step["terminal_state"] = terminal_state or "completed"
        return f"{action} {chapter}: staged {len(step['change_set'])} proposal(s)"

    async def research_note(self, project_id: str, query: str) -> str:
        """Run plan research through retrieval + isolated retrieve worker."""

        query = str(query or "").strip()
        if not query:
            return "（空查询）"
        try:
            items = (
                await self.select_engine.retrieval_select(
                    project_id=project_id,
                    query=query,
                    item_types=["fact", "character", "world"],
                    storage=self.storage_adapter,
                    top_k=8,
                )
                or []
            )
        except Exception as exc:
            logger.warning("plan research retrieval failed: %s", exc)
            return f"retrieval_failed:{safe_error_code(exc)}"

        candidates = [
            {
                "id": str(getattr(item, "id", idx)),
                "text": str(getattr(item, "content", "") or "").strip(),
                "type": str(getattr(item, "type", "") or ""),
            }
            for idx, item in enumerate(items)
        ]
        task = await self.worker_service.run_task(
            project_id=project_id,
            kind="retrieve",
            input={"query": query, "candidates": candidates, "limit": 5},
            budget={"max_items": 5, "max_input_chars": 20000, "max_output_chars": 8000},
        )
        hits = ((task.output or {}).get("hits") or []) if task.status == "completed" else []
        parts = [str(hit.get("text") or "").strip()[:120] for hit in hits if str(hit.get("text") or "").strip()]
        return "；".join(parts) if parts else "未检索到直接相关 canon/card。"
