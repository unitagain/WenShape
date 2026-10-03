# -*- coding: utf-8 -*-
"""
文枢 WenShape - 深度上下文感知的智能体小说创作系统
WenShape - Deep Context-Aware Agent-Based Novel Writing System

Copyright © 2025-2026 WenShape Team
License: PolyForm Noncommercial License 1.0.0

模块说明 / Module Description:
  D2 联合验收（自动化可及部分）——§9.1 金路径中可离线复现的跨组件链路
  回归：多章计划的终态贯通 + 提案落盘 + change set 采纳 + D1 恢复协议的
  端到端衔接；反问恢复与选区链路（C2/C3 合同已冻结单层，这里补 turn 级
  串联）。人工金路径（真实浏览器、桌面 smoke、真实模型）见 plan.md §9.1。
  D2 joint acceptance (automatable subset) - cross-component regressions of
  §9.1 golden paths that can run offline: multi-chapter plan terminal-state
  passthrough + proposal staging + change set acceptance + D1 recovery
  end-to-end; clarification/selection chains at turn level.
"""

import asyncio

import httpx
import pytest
from fastapi import FastAPI

from app.orchestrator.orchestrator import Orchestrator


class _FakeGateway:
    """计划生成（planner）用：两步串行计划。"""

    def get_provider_for_agent(self, name):
        return "fake"

    async def chat(self, messages, **kwargs):
        return {
            "content": (
                '{"steps": ['
                '{"id": 1, "action": "write", "chapter": "V1C101", "description": "写新章一"},'
                '{"id": 2, "action": "write", "chapter": "V1C102", "description": "写新章二"}'
                "]}"
            ),
            "provider": "fake",
            "model": "fake",
        }


class _ProposalWriterService:
    """第一步成功产出提案、第二步 incomplete（截断）——冻结终态贯通链。"""

    def __init__(self):
        self.calls = []

    async def run(self, project_id, chapter, message, **options):
        self.calls.append({"chapter": chapter, **options})
        if len(self.calls) == 1:
            return {
                "success": True,
                "terminal_state": "completed",
                "changed": True,
                "change_set": [
                    {
                        "asset_type": "chapter",
                        "asset_id": chapter,
                        "original": "",
                        "revised": f"{chapter} 的提案正文PLAN_PROPOSAL_A。",
                        "base_revision": 0,
                    }
                ],
                "agent_run": {"iterations": 3},
            }
        return {
            "success": False,
            "terminal_state": "incomplete",
            "reason": "max_iterations",
            "changed": False,
            "change_set": [
                {
                    "asset_type": "chapter",
                    "asset_id": chapter,
                    "original": "",
                    "revised": f"{chapter} 的部分提案PLAN_PROPOSAL_B。",
                    "base_revision": 0,
                }
            ],
            "agent_run": {"iterations": 12},
        }


def _orch_with_plan(tmp_path):
    orch = Orchestrator(str(tmp_path))
    gateway = _FakeGateway()
    # PlanExecutionService 构造时已绑定真实 gateway 实例——必须替换服务持有的引用，
    # 否则 planner 走真实 provider（orch.gateway 属性替换只影响 orchestrator 自身方法）。
    orch.plan_execution_service.gateway = gateway
    writer = _ProposalWriterService()
    orch.plan_execution_service.writing_service = writer
    return orch, writer


class TestMultiChapterPlanGoldenPath:
    """§9.1 多章计划：逐步进度/终态、提案不落盘、逐资产采纳。"""

    def test_plan_incomplete_step_stops_and_preserves_proposal(self, tmp_path):
        orch, writer = _orch_with_plan(tmp_path)
        plan = asyncio.run(orch.application.plans.create_plan("p1", goal="写两章"))
        assert plan and len(plan["steps"]) == 2

        result = asyncio.run(orch.application.plans.execute_plan("p1", plan["id"]))
        # A4 终态贯通：第一步 done、第二步 incomplete、plan 不伪装完成。
        steps = result["plan"]["steps"]
        assert steps[0]["status"] == "done"
        assert steps[1]["status"] == "incomplete"
        assert result["plan"]["status"] == "incomplete"
        assert result["success"] is False
        # U8 提案不落盘：两章正文都还是空。
        for chapter in ("V1C101", "V1C102"):
            text, _ = asyncio.run(orch.draft_storage.get_working_text("p1", chapter))
            assert not str(text or "").strip()
        # 提案保留在 step 上（生成提案 ≠ 用户采纳）。
        assert steps[0]["change_set"] and "PLAN_PROPOSAL_A" in steps[0]["change_set"][0]["revised"]
        assert steps[1]["change_set"] and "PLAN_PROPOSAL_B" in steps[1]["change_set"][0]["revised"]

    def test_accepted_change_set_lands_and_journal_recovers(self, tmp_path):
        """提案采纳 + D1 恢复的端到端衔接：采纳→journal applied→重复 resume 安全。"""
        orch, writer = _orch_with_plan(tmp_path)
        plan = asyncio.run(orch.application.plans.create_plan("p1", goal="写两章"))
        result = asyncio.run(orch.application.plans.execute_plan("p1", plan["id"]))
        steps = result["plan"]["steps"]

        # 作者采纳第一步提案（change set 通道，唯一落盘入口）。
        applied = asyncio.run(orch.apply_change_set("p1", steps[0]["change_set"]))
        assert applied["success"] is True, applied
        text, _ = asyncio.run(orch.draft_storage.get_working_text("p1", "V1C101"))
        assert "PLAN_PROPOSAL_A" in str(text or "")

        # D1 恢复协议衔接：该 journal 已全部 applied，resume 幂等无害。
        journal_id = applied["journal_id"]
        resumed = asyncio.run(orch.resume_change_set("p1", journal_id))
        assert resumed["success"] is True and resumed.get("reason") == "all_applied"

    def test_partial_accept_then_resume_second_proposal(self, tmp_path):
        """部分成功后（模拟）经 D1 恢复入口补齐第二章提案。"""
        import hashlib

        orch, writer = _orch_with_plan(tmp_path)
        plan = asyncio.run(orch.application.plans.create_plan("p1", goal="写两章"))
        result = asyncio.run(orch.application.plans.execute_plan("p1", plan["id"]))
        steps = result["plan"]["steps"]

        # 手工构造 journal 意图（模拟第二步提案在写入中断）：目标 = 第二步提案。
        store = orch.change_set_journal_store()
        proposal = steps[1]["change_set"][0]
        store.record_write_intent(
            "journal_partial",
            "p1",
            "turn_sim",
            [
                {
                    "asset_type": "chapter",
                    "asset_id": "V1C102",
                    "base_revision": 0,
                    "content_sha256": hashlib.sha256(proposal["revised"].encode("utf-8")).hexdigest(),
                    "revised_content": proposal["revised"],
                    "original_content": "",
                }
            ],
        )
        # 恢复预览 → 续做 → 落盘。
        preview = asyncio.run(orch.inspect_change_set_journal("p1"))
        assert any(j["journal_id"] == "journal_partial" for j in preview["journals"])
        resumed = asyncio.run(orch.resume_change_set("p1", "journal_partial"))
        assert resumed["success"] is True, resumed
        text, _ = asyncio.run(orch.draft_storage.get_working_text("p1", "V1C102"))
        assert "PLAN_PROPOSAL_B" in str(text or "")


class TestClarificationChainAtTurnLevel:
    """§9.1 反问链路的 turn 级串联（单层合同已由 C2/C3 冻结）。"""

    def test_requires_input_turn_records_both_events(self, tmp_path):
        """反问暂停（requires_input）的 turn：user 事件 + assistant 终态事件都在场。"""
        from app.orchestrator.chat_turn_service import ChatTurnService

        class _RequiresInputWriter:
            async def run(self, project_id, chapter, message, **options):
                return {
                    "success": True,
                    "terminal_state": "requires_input",
                    "changed": False,
                    "questions": [{"question": "主角此刻知道真相吗？"}],
                }

        real = Orchestrator(str(tmp_path))
        real.writing_service = _RequiresInputWriter()

        class _Owner:
            pass

        owner = _Owner()
        owner.writing_service = real.writing_service
        owner.select_engine = real.select_engine
        owner.draft_storage = real.draft_storage
        owner.session_history = real.session_history
        owner.context_planning_service = real.context_planning_service
        owner.memory_pack_storage = real.memory_pack_storage
        owner.decide_writing_action = real.decide_writing_action
        owner.application = real.application
        owner._active_turn_scopes = {}
        service = ChatTurnService(owner)

        result = asyncio.run(service.run("p1", "V1C001", "写一段", conversation_id=""))
        assert result.get("terminal_state") == "requires_input"
        history = asyncio.run(real.session_history.load("p1"))
        roles = [item["role"] for item in history]
        assert "user" in roles and "assistant" in roles, "C2 权威事件覆盖反问暂停场景"


class TestSelectionChainAtTurnLevel:
    """§9.1 选区链路的 turn 级串联。"""

    def test_selection_flows_from_turn_to_writer(self, tmp_path):
        from app.orchestrator.chat_turn_service import ChatTurnService

        captured = {}

        class _CaptureWriter:
            async def run(self, project_id, chapter, message, **options):
                captured.update(options)
                return {"success": True, "terminal_state": "completed", "changed": False}

        real = Orchestrator(str(tmp_path))

        class _Owner:
            pass

        owner = _Owner()
        owner.writing_service = _CaptureWriter()
        owner.select_engine = real.select_engine
        owner.draft_storage = real.draft_storage
        owner.session_history = real.session_history
        owner.context_planning_service = real.context_planning_service
        owner.memory_pack_storage = real.memory_pack_storage
        owner.decide_writing_action = real.decide_writing_action
        owner.application = real.application
        owner._active_turn_scopes = {}
        service = ChatTurnService(owner)

        asyncio.run(
            service.run(
                "p1",
                "V1C001",
                "润色这段",
                has_selection=True,
                selection_text="选中的原文段落SELECTION_CHAIN。",
            )
        )
        assert captured.get("selection_text") == "选中的原文段落SELECTION_CHAIN。", "选区贯穿 turn → Writer（C3）"
        assert captured.get("has_selection") is True


@pytest.mark.asyncio
async def test_http_chat_history_and_request_retry(tmp_path, monkeypatch):
    from app.routers import session

    orch = Orchestrator(str(tmp_path))
    calls = []

    async def reply(*args, **kwargs):
        calls.append(args)
        return {"success": True, "action": "reply", "message": "后端完整答复" * 200}

    monkeypatch.setattr(orch.writing_service, "run", reply)
    monkeypatch.setattr(session, "get_orchestrator", lambda *args: orch)
    api = FastAPI()
    api.include_router(session.router)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api), base_url="http://test") as client:
        request = {"chapter": "V1C001", "message": "写开头", "request_id": "http_retry"}
        first = await client.post("/projects/p1/session/chat", json=request)
        assert first.status_code == 200 and first.json()["success"]
        second = await client.post("/projects/p1/session/chat", json=request)
        assert second.json()["reason"] == "turn_already_recorded"
        history = (await client.get("/projects/p1/session/history")).json()["messages"]
        assert len(history) == 2 and len(calls) == 1
        assert history[-1]["content"] == "后端完整答复" * 200
        legacy_event = {"role": "assistant", "content": "兼容事件", "event_id": "client_once"}
        await client.post("/projects/p1/session/history", json=legacy_event)
        await client.post("/projects/p1/session/history", json=legacy_event)
        history = (await client.get("/projects/p1/session/history")).json()["messages"]
        assert len(history) == 3


@pytest.mark.asyncio
async def test_http_partial_apply_preview_restart_resume(tmp_path, monkeypatch):
    from app.routers import session

    orch = Orchestrator(str(tmp_path))
    real_save = orch.draft_storage.save_current_draft

    async def fail_second(*args, **kwargs):
        if kwargs["chapter"] == "V1C002":
            raise OSError("synthetic disk failure")
        return await real_save(*args, **kwargs)

    monkeypatch.setattr(orch.draft_storage, "save_current_draft", fail_second)
    monkeypatch.setattr(session, "get_orchestrator", lambda *args: orch)
    api = FastAPI()
    api.include_router(session.router)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api), base_url="http://test") as client:
        changes = [
            {"asset_type": "chapter", "asset_id": chapter, "original": "", "revised": chapter, "base_revision": 0}
            for chapter in ("V1C001", "V1C002")
        ]
        result = (await client.post("/projects/p1/session/apply-change-set", json={"changes": changes})).json()
        assert result["success"] is False and len(result["applied"]) == 1
        journal_id = result["journal_id"]
        orch = Orchestrator(str(tmp_path))
        preview = (await client.get("/projects/p1/session/change-set/pending")).json()
        assert len(preview["journals"][0]["assets"]) == 2
        assert preview["journals"][0]["assets"][1]["revised"] == "V1C002"
        wrong_project = (await client.post(f"/projects/p2/session/change-set/{journal_id}/resume")).json()
        assert wrong_project["reason"] == "journal_not_found"
        resumed = (await client.post(f"/projects/p1/session/change-set/{journal_id}/resume")).json()
        assert resumed["success"] is True
        again = (await client.post(f"/projects/p1/session/change-set/{journal_id}/resume")).json()
        assert again["reason"] == "all_applied"
        assert (await orch.draft_storage.get_working_text("p1", "V1C002"))[0] == "V1C002"
