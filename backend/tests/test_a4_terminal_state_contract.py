# -*- coding: utf-8 -*-
"""
文枢 WenShape - 深度上下文感知的智能体小说创作系统
WenShape - Deep Context-Aware Agent-Based Novel Writing System

Copyright © 2025-2026 WenShape Team
License: PolyForm Noncommercial License 1.0.0

模块说明 / Module Description:
  A4 结构化终态贯通合同测试 - Writer 的四态终态（completed/incomplete/cancelled/
  failed）原样穿透 PlanExecutionService 聚合，不再被「runner 没抛异常」汇总成
  done（评估报告 F06）。
  A4 terminal-state contract tests - the Writer's four-state terminal contract
  passes through plan aggregation unchanged; "runner did not raise" no longer
  counts as step completion (finding F06).
"""

import asyncio

from app.orchestrator.orchestrator import Orchestrator


def _orch(tmp_path):
    return Orchestrator(str(tmp_path))


def _seed(orch, steps, plan_id="p1"):
    plan = {"id": plan_id, "goal": "g", "steps": steps, "status": "planning"}
    asyncio.run(orch.plan_store.write_plan("proj", plan))


def _writing_step(step_id=1, chapter="V1C001", action="write"):
    return {
        "id": step_id,
        "action": action,
        "description": "写作步骤",
        "chapter": chapter,
        "status": "pending",
    }


class _FakeWritingService:
    """返回 F06 探针同款 WritingResult：合法形状、success=False、incomplete。"""

    def __init__(self, *, success=False, terminal_state="incomplete", reason="max_iterations", cancelled=False, change_set=None):
        self.success = success
        self.terminal_state = terminal_state
        self.reason = reason
        self.cancelled = cancelled
        self.change_set = change_set or []
        self.calls = []

    async def run(self, project_id, chapter, message, **kwargs):
        self.calls.append((project_id, chapter, message))
        return {
            "success": self.success,
            "terminal_state": self.terminal_state,
            "reason": self.reason,
            "cancelled": self.cancelled,
            "changed": bool(self.change_set),
            "change_set": self.change_set,
            "agent_run": {"iterations": 12},
        }


class TestF06ProbeBlocked:
    """F06 核心反例：success=False + incomplete 不得汇总为 done/success=True。"""

    def test_incomplete_step_not_summarized_as_done(self, tmp_path):
        orch = _orch(tmp_path)
        _seed(orch, [_writing_step(), _writing_step(step_id=2, chapter="V1C002")])
        fake = _FakeWritingService(success=False, terminal_state="incomplete", reason="max_iterations")
        orch.application.plans.writing_service = fake

        result = asyncio.run(orch.application.plans.execute_plan("proj", "p1"))

        step1 = result["plan"]["steps"][0]
        step2 = result["plan"]["steps"][1]
        assert step1["status"] == "incomplete", "incomplete 步骤不得标 done"
        assert step1["terminal_state"] == "incomplete"
        assert step2["status"] == "pending", "未完成步骤的后续步骤不得继续依赖"
        assert result["plan"]["status"] == "incomplete"
        assert result["success"] is False

    def test_failed_writer_step_maps_to_failed(self, tmp_path):
        orch = _orch(tmp_path)
        _seed(orch, [_writing_step()])
        orch.application.plans.writing_service = _FakeWritingService(
            success=False, terminal_state="failed", reason="provider_error"
        )
        result = asyncio.run(orch.application.plans.execute_plan("proj", "p1"))
        assert result["plan"]["steps"][0]["status"] == "failed"
        assert result["plan"]["status"] == "failed"
        assert result["success"] is False

    def test_cancelled_writer_step_maps_to_interrupted_plan(self, tmp_path):
        orch = _orch(tmp_path)
        _seed(orch, [_writing_step()])
        orch.application.plans.writing_service = _FakeWritingService(
            success=False, terminal_state="cancelled", cancelled=True
        )
        result = asyncio.run(orch.application.plans.execute_plan("proj", "p1"))
        assert result["plan"]["steps"][0]["status"] == "cancelled"
        assert result["plan"]["status"] == "interrupted", "cancelled 对用户呈现为中断，不伪装完成"
        assert result["success"] is False

    def test_proposals_still_staged_on_incomplete(self, tmp_path):
        """未完成步骤的已有提案保留（「生成提案」与「用户采纳」分开，U8 语义）。"""
        orch = _orch(tmp_path)
        _seed(orch, [_writing_step()])
        proposal = {
            "asset_type": "chapter",
            "asset_id": "V1C001",
            "original": "旧",
            "revised": "新",
            "base_revision": 3,
        }
        orch.application.plans.writing_service = _FakeWritingService(
            success=False, terminal_state="incomplete", change_set=[proposal]
        )
        result = asyncio.run(orch.application.plans.execute_plan("proj", "p1"))
        step = result["plan"]["steps"][0]
        assert step["status"] == "incomplete"
        assert step["change_set"] == [proposal], "提案保留供作者审阅，步骤终态与采纳解耦"

    def test_completed_step_with_proposals_still_done(self, tmp_path):
        """正常完成路径不回归：success=True → done，提案计数进入 result 摘要。"""
        orch = _orch(tmp_path)
        _seed(orch, [_writing_step()])
        orch.application.plans.writing_service = _FakeWritingService(
            success=True,
            terminal_state="completed",
            change_set=[{"asset_type": "chapter", "asset_id": "V1C001", "revised": "x"}],
        )
        result = asyncio.run(orch.application.plans.execute_plan("proj", "p1"))
        assert result["success"] is True
        assert result["plan"]["status"] == "done"
        step = result["plan"]["steps"][0]
        assert step["status"] == "done"
        assert step["terminal_state"] == "completed"
        assert "staged 1 proposal" in step["result"]


class TestNonStandardTerminalVocabulary:
    """Writer 成功但报告非四态词汇（如 requires_input）→ incomplete 而非 done。"""

    def test_requires_input_maps_to_incomplete(self, tmp_path):
        orch = _orch(tmp_path)
        _seed(orch, [_writing_step()])
        orch.application.plans.writing_service = _FakeWritingService(
            success=True, terminal_state="requires_input"
        )
        result = asyncio.run(orch.application.plans.execute_plan("proj", "p1"))
        step = result["plan"]["steps"][0]
        assert step["status"] == "incomplete", "非四态词汇映射为 incomplete 状态"
        assert step["terminal_state"] == "incomplete", "step.terminal_state 统一四态契约"
        assert "requires_input" in step["result"], "原始词汇保留在 result 摘要供诊断"
        assert result["plan"]["status"] == "incomplete"

    def test_success_without_terminal_state_defaults_completed(self, tmp_path):
        """无终态字段的成功结果仍视为完成（兼容正常无 agent_run 的路径）。"""
        orch = _orch(tmp_path)
        _seed(orch, [_writing_step()])

        class _MinimalService:
            async def run(self, project_id, chapter, message, **kwargs):
                return {"success": True, "changed": True, "change_set": []}

        orch.application.plans.writing_service = _MinimalService()
        result = asyncio.run(orch.application.plans.execute_plan("proj", "p1"))
        assert result["success"] is True
        assert result["plan"]["steps"][0]["status"] == "done"


class TestLegacyRunnerCompat:
    """注入式裸字符串 runner 保持 completed 语义（既有测试与 research 分支依赖）。"""

    def test_string_runner_result_still_done(self, tmp_path):
        orch = _orch(tmp_path)
        _seed(orch, [{"id": 1, "action": "research", "description": "d", "status": "pending"}])

        async def runner(pid, step):
            return "ran ok"

        result = asyncio.run(orch.application.plans.execute_plan("proj", "p1", step_runner=runner))
        assert result["success"] is True
        assert result["plan"]["steps"][0]["status"] == "done"
        assert result["plan"]["steps"][0]["result"] == "ran ok"

    def test_dict_runner_without_terminal_state_is_done(self, tmp_path):
        """dict 结果但缺 terminal_state：无失败信号视为 done（宽容兼容）。"""
        orch = _orch(tmp_path)
        _seed(orch, [{"id": 1, "action": "research", "description": "d", "status": "pending"}])

        async def runner(pid, step):
            return {"summary": "ok"}

        result = asyncio.run(orch.application.plans.execute_plan("proj", "p1", step_runner=runner))
        assert result["plan"]["steps"][0]["status"] == "done"
        assert result["plan"]["steps"][0]["result"] == "ok"


class TestAnalyzeBranch:
    """analyze 分支的 success=False 不得被字符串拼接吞掉（F06 附带审查项）。"""

    def test_analyze_failure_maps_to_failed(self, tmp_path):
        orch = _orch(tmp_path)
        _seed(orch, [{"id": 1, "action": "analyze", "chapter": "V1C001", "description": "d", "status": "pending"}])

        async def fake_analyze(project_id, chapter):
            return {"success": False, "error": "no_content"}

        orch.application.plans.analyze_chapter = fake_analyze
        result = asyncio.run(orch.application.plans.execute_plan("proj", "p1"))
        assert result["plan"]["steps"][0]["status"] == "failed"
        assert result["plan"]["status"] == "failed"
        assert result["success"] is False

    def test_analyze_success_maps_to_done(self, tmp_path):
        orch = _orch(tmp_path)
        _seed(orch, [{"id": 1, "action": "analyze", "chapter": "V1C001", "description": "d", "status": "pending"}])

        async def fake_analyze(project_id, chapter):
            return {"success": True}

        orch.application.plans.analyze_chapter = fake_analyze
        result = asyncio.run(orch.application.plans.execute_plan("proj", "p1"))
        assert result["plan"]["steps"][0]["status"] == "done"
        assert result["success"] is True
