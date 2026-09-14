# -*- coding: utf-8 -*-
"""Phase 12 / 阶段 C · 单 Writer 主循环（统一对话入口）回归测试。

验证 intent continue 分支 + run_chat_turn 的新编排：
  - 默认主路径：写/改统一交给 agent 主循环（run_writing_agent → agentic_write），对齐 AI coding；
  - 能力降级：单 Writer 返回明确 incomplete/failed，不切换旧 workflow；
  - plan 仍走显式拆解。
全部用实例属性覆盖 + Fake gateway，无网络、无真实 LLM。
"""

import asyncio
from unittest.mock import patch

import pytest

from app.orchestrator.orchestrator import Orchestrator
from app.agents.intent import classify_writing_intent

# ---------- intent continue ----------


def test_intent_continue_when_draft_exists():
    d = asyncio.run(classify_writing_intent("接着写下去", has_selection=False, has_draft=True))
    assert d["action"] == "continue"


def test_intent_continue_without_draft_is_write():
    d = asyncio.run(classify_writing_intent("接着写", has_selection=False, has_draft=False))
    assert d["action"] == "write"


def test_outline_planning_request_stays_on_writer_path():
    decision = asyncio.run(
        classify_writing_intent(
            "在大纲中继续规划后续几章剧情",
            has_selection=False,
            has_draft=False,
        )
    )
    assert decision["action"] == "write"


def test_explicit_multi_chapter_execution_still_uses_plan_path():
    decision = asyncio.run(
        classify_writing_intent(
            "按照现有大纲逐章写完第8到10章",
            has_selection=False,
            has_draft=True,
        )
    )
    assert decision["action"] == "plan"


# ---------- run_chat_turn 编排 ----------


def _orch(tmp_path):
    with (
        patch("app.orchestrator.orchestrator.create_embeddings_backend", return_value=None),
        patch("app.orchestrator.orchestrator.create_reranker_backend", return_value=None),
    ):
        orch = Orchestrator(str(tmp_path))
    proj_dir = tmp_path / "p"
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "project.yaml").write_text("writer:\n  clarification:\n    auto_trigger: auto\n", encoding="utf-8")
    return orch


def _seed_draft(orch, *, content="existing draft"):
    asyncio.run(orch.draft_storage.save_draft("p", "V1C001", "v1", content, len(content)))


def test_chat_turn_agent_is_default_path(tmp_path):
    """默认主路径：run_chat_turn 把写/改统一交给 agent 主循环（agentic_write）。"""
    orch = _orch(tmp_path)

    async def fake_decide(*a, **k):
        return {"action": "write"}

    async def fake_agent(pid, ch, msg, **k):
        return {"success": True, "action": "agentic_write", "changed": True}

    orch.decide_writing_action = fake_decide
    orch.writing_service.run = fake_agent
    r = asyncio.run(orch.run_chat_turn("p", "V1C001", "写个新场景"))
    assert r["action"] == "agentic_write" and r["success"]
    assert r["route_contract"]["path"] == "agentic_writer"
    assert r["context_plan"]["route_path"] == "agentic_writer"
    assert any(t["name"] == "write_content" for t in r["context_plan"]["tool_loadout"])
    assert "latency_ms" in r["context_plan"]["budget"]


class _WriterClarificationGateway:
    def __init__(self):
        self.calls = 0
        self.requests = []

    def get_provider_for_agent(self, _name):
        return "fake"

    async def chat(self, messages, **kwargs):
        self.calls += 1
        self.requests.append({"messages": messages, "tools": kwargs.get("tools")})
        if self.calls == 1:
            return {
                "content": None,
                "tool_calls": [
                    {"id": "read-1", "type": "function", "name": "read_outline", "arguments": "{}"}
                ],
                "usage": {},
                "model": "fake",
                "finish_reason": "tool_calls",
            }
        if self.calls == 2:
            return {
                "content": None,
                "tool_calls": [
                    {
                        "id": "ask-1",
                        "type": "function",
                        "name": "ask_clarification",
                        "arguments": (
                            '{"questions":[{"type":"plot","text":"这场对决应公开决裂还是暂时和解？",'
                            '"reason":"决定本章收束"},{"text":"本章继续使用林舟视角吗？"}]}'
                        ),
                    }
                ],
                "usage": {},
                "model": "fake",
                "finish_reason": "tool_calls",
            }
        if self.calls == 3:
            assert "作者回答" in str(messages[-1].get("content") or "")
            return {
                "content": None,
                "tool_calls": [
                    {
                        "id": "write-1",
                        "type": "function",
                        "name": "write_content",
                        "arguments": '{"chapter_id":"V1C001","content":"林舟在桥上公开与盟友决裂。","mode":"replace"}',
                    }
                ],
                "usage": {},
                "model": "fake",
                "finish_reason": "tool_calls",
            }
        return {
            "content": None,
            "tool_calls": [
                {
                    "id": "finish-1",
                    "type": "function",
                    "name": "finish_turn",
                    "arguments": (
                        '{"change_type":"chapter_write","fact_operation":"merge",'
                        '"chapter_summary":"林舟在桥上公开决裂。","fact_candidates":[],'
                        '"message":"本章已完成。"}'
                    ),
                }
            ],
            "usage": {},
            "model": "fake",
            "finish_reason": "tool_calls",
        }


def test_writer_tool_requests_clarification_after_retrieval_without_writing(tmp_path):
    orch = _orch(tmp_path)
    events = []

    async def fake_decide(*_args, **_kwargs):
        return {"action": "write"}

    async def capture_progress(payload):
        events.append(payload)

    gateway = _WriterClarificationGateway()
    orch.decide_writing_action = fake_decide
    orch.writing_service.gateway = gateway
    orch.writing_service.progress_callback = capture_progress
    result = asyncio.run(orch.run_chat_turn("p", "V1C001", "写桥上对决"))

    assert result["terminal_state"] == "requires_input"
    assert result["reason"] == "clarification_requested"
    assert len(result["questions"]) == 2
    assert gateway.calls == 2
    assert result.get("changed") is False
    assert asyncio.run(orch.draft_storage.get_final_draft("p", "V1C001")) is None
    assert any(tool["name"] == "ask_clarification" for tool in result["context_plan"]["tool_loadout"])
    clarification_call = next(
        index
        for index, event in enumerate(events)
        if event.get("type") == "agent_tool_call" and event.get("name") == "ask_clarification"
    )
    clarification_result = next(
        index
        for index, event in enumerate(events)
        if event.get("type") == "agent_tool_result" and event.get("name") == "ask_clarification"
    )
    input_required = next(index for index, event in enumerate(events) if event.get("type") == "agent_input_required")
    assert clarification_call < clarification_result < input_required
    assert events[input_required]["questions"] == result["questions"]
    assert events[input_required]["turn_id"] == result["runtime"]["turn_id"]


def test_clarification_answers_resume_the_same_writer_loop_contract(tmp_path):
    orch = _orch(tmp_path)

    async def fake_decide(*_args, **_kwargs):
        return {"action": "write"}

    gateway = _WriterClarificationGateway()
    orch.decide_writing_action = fake_decide
    orch.writing_service.gateway = gateway
    first = asyncio.run(orch.run_chat_turn("p", "V1C001", "写桥上对决"))
    follow_up = (
        "写桥上对决\n\n补充信息：\n"
        f"问题：{first['questions'][0]['text']}\n作者回答：公开决裂\n\n"
        f"问题：{first['questions'][1]['text']}\n作者回答：继续林舟视角"
    )
    second = asyncio.run(orch.run_chat_turn("p", "V1C001", follow_up))

    assert second["success"] is True
    assert second["changed"] is True
    assert second["content"] == "林舟在桥上公开与盟友决裂。"
    assert gateway.calls == 4


def test_always_clarification_blocks_finish_until_writer_asks(tmp_path):
    orch = _orch(tmp_path)
    (tmp_path / "p" / "project.yaml").write_text(
        "writer:\n  clarification:\n    auto_trigger: always\n",
        encoding="utf-8",
    )

    class _PolicyGateway:
        def __init__(self):
            self.calls = 0
            self.system = ""
            self.tool_names = []

        def get_provider_for_agent(self, _name):
            return "fake"

        async def chat(self, messages, **kwargs):
            self.calls += 1
            self.system = str(messages[0].get("content") or "")
            self.tool_names = [tool["function"]["name"] for tool in kwargs.get("tools") or []]
            if self.calls == 2:
                assert "clarification_required" in str(messages[-1].get("content") or "")
                return {
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "ask-1",
                            "type": "function",
                            "name": "ask_clarification",
                            "arguments": '{"questions":[{"text":"本章冲突应公开爆发还是暂时压下？"}]}',
                        }
                    ],
                    "usage": {},
                    "model": "fake",
                    "finish_reason": "tool_calls",
                }
            return {
                "content": None,
                "tool_calls": [
                    {
                        "id": "finish-1",
                        "type": "function",
                        "name": "finish_turn",
                        "arguments": (
                            '{"change_type":"conversation","fact_operation":"none",'
                            '"chapter_summary":"","fact_candidates":[],"message":"信息已足够。"}'
                        ),
                    }
                ],
                "usage": {},
                "model": "fake",
                "finish_reason": "tool_calls",
            }

    async def fake_decide(*_args, **_kwargs):
        return {"action": "write"}

    gateway = _PolicyGateway()
    orch.decide_writing_action = fake_decide
    orch.writing_service.gateway = gateway
    assert asyncio.run(orch.writing_service._resolve_clarification_settings("p"))["auto_trigger"] == "always"
    result = asyncio.run(orch.run_chat_turn("p", "V1C001", "按现有设定继续"))

    assert result.get("terminal_state") == "requires_input", result
    assert result["questions"] == [{"text": "本章冲突应公开爆发还是暂时压下？"}]
    assert gateway.calls == 2
    assert "必须先调用 ask_clarification" in gateway.system
    assert "ask_clarification" in gateway.tool_names


def test_always_clarification_answer_resume_does_not_ask_again(tmp_path):
    orch = _orch(tmp_path)
    (tmp_path / "p" / "project.yaml").write_text(
        "writer:\n  clarification:\n    auto_trigger: always\n",
        encoding="utf-8",
    )

    class _ResumeGateway:
        def __init__(self):
            self.system = ""

        def get_provider_for_agent(self, _name):
            return "fake"

        async def chat(self, messages, **_kwargs):
            self.system = str(messages[0].get("content") or "")
            if any(message.get("role") == "tool" for message in messages):
                return {
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "finish-1",
                            "type": "function",
                            "name": "finish_turn",
                            "arguments": (
                                '{"change_type":"chapter_write","fact_operation":"none",'
                                '"chapter_summary":"","fact_candidates":[],"message":"已完成。"}'
                            ),
                        }
                    ],
                    "usage": {},
                    "model": "fake",
                    "finish_reason": "tool_calls",
                }
            return {
                "content": None,
                "tool_calls": [
                    {
                        "id": "write-1",
                        "type": "function",
                        "name": "write_content",
                        "arguments": '{"chapter_id":"V1C001","content":"冲突公开爆发。","mode":"replace"}',
                    }
                ],
                "usage": {},
                "model": "fake",
                "finish_reason": "tool_calls",
            }

    async def fake_decide(*_args, **_kwargs):
        return {"action": "write"}

    orch.decide_writing_action = fake_decide
    gateway = _ResumeGateway()
    orch.writing_service.gateway = gateway
    result = asyncio.run(
        orch.run_chat_turn(
            "p",
            "V1C001",
            "按现有设定继续\n\n补充信息：\n问题：冲突如何收束？\n作者回答：公开爆发",
        )
    )

    assert result["success"] is True
    assert result["changed"] is True
    # 恢复轮策略文本：门控已关，提示不得再要求「必须先反问」，否则诱导重复反问
    assert "必须先调用 ask_clarification" not in gateway.system
    assert "已获作者回答" in gateway.system


def test_chat_turn_without_active_chapter_still_enters_single_writer(tmp_path):
    orch = _orch(tmp_path)
    captured = {}

    async def fake_decide(*_args, **_kwargs):
        return {"action": "write"}

    async def fake_agent(project_id, chapter, message, **kwargs):
        captured.update({"project_id": project_id, "chapter": chapter, "message": message, **kwargs})
        return {
            "success": True,
            "action": "agentic_write",
            "changed": True,
            "chapter_target": {"chapter": "V1C1", "title": "开端", "create": True},
        }

    orch.decide_writing_action = fake_decide
    orch.writing_service.run = fake_agent
    result = asyncio.run(orch.run_chat_turn("p", "", "新建第一章并撰写"))

    assert result["success"] is True
    assert captured["chapter"] == ""
    assert result["chapter_target"]["chapter"] == "V1C1"


class _CreateChapterGateway:
    def __init__(self):
        self.calls = 0

    def get_provider_for_agent(self, _name):
        return "fake"

    async def chat(self, _messages, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            return {
                "content": "我先建立新章节目标。",
                "tool_calls": [
                    {
                        "id": "create-1",
                        "type": "function",
                        "name": "create_chapter",
                        "arguments": '{"chapter_id":"V1C1","title":"雨夜新城"}',
                    }
                ],
                "usage": {},
                "model": "fake",
                "finish_reason": "tool_calls",
            }
        if self.calls == 2:
            return {
                "content": "现在写入正文。",
                "tool_calls": [
                    {
                        "id": "write-1",
                        "type": "function",
                        "name": "write_content",
                        "arguments": '{"chapter_id":"V1C1","content":"林舟抵达新城。","mode":"replace"}',
                    }
                ],
                "usage": {},
                "model": "fake",
                "finish_reason": "tool_calls",
            }
        return {
            "content": "现在提交收尾。",
            "tool_calls": [
                {
                    "id": "finish-1",
                    "type": "function",
                    "name": "finish_turn",
                    "arguments": (
                        '{"change_type":"chapter_write","fact_operation":"merge",'
                        '"chapter_summary":"林舟在雨夜抵达新城。","fact_candidates":['
                        '{"statement":"林舟抵达新城","evidence":"林舟抵达新城。"}],'
                        '"message":"第一章已完成。"}'
                    ),
                }
            ],
            "usage": {},
            "model": "fake",
            "finish_reason": "tool_calls",
        }


def test_new_chapter_is_proposed_before_user_acceptance(tmp_path):
    orch = _orch(tmp_path)
    events = []

    async def fake_decide(*_args, **_kwargs):
        return {"action": "write"}

    async def capture_event(payload):
        events.append(dict(payload))

    orch.decide_writing_action = fake_decide
    orch.writing_service.gateway = _CreateChapterGateway()
    orch.writing_service.progress_callback = capture_event
    orch.writing_service.detect_proposals = None

    result = asyncio.run(orch.run_chat_turn("p", "", "新建第一章并写完"))

    assert result["success"] is True
    assert "auto_commit" not in result
    proposal = next(item for item in result["change_set"] if item["asset_type"] == "chapter")
    assert proposal["asset_id"] == "V1C1"
    assert proposal["original"] == "" and proposal["revised"] == "林舟抵达新城。"
    assert asyncio.run(orch.draft_storage.get_final_draft("p", "V1C1")) is None
    stream_end = next(event for event in events if event.get("type") == "stream_end")
    assert "auto_commit" not in stream_end
    assert stream_end["change_set"][0]["asset_id"] == "V1C1"

    applied = asyncio.run(orch.apply_change_set("p", [proposal]))
    assert applied["success"] is True
    assert asyncio.run(orch.draft_storage.get_final_draft("p", "V1C1")) == "林舟抵达新城。"


def test_apply_change_set_preflights_all_revisions_before_any_write(tmp_path):
    orch = _orch(tmp_path)
    asyncio.run(orch.draft_storage.save_current_draft("p", "V1C1", "第一章。"))
    asyncio.run(orch.draft_storage.save_current_draft("p", "V1C2", "第二章。"))
    first_revision = orch.draft_storage.get_draft_revision("p", "V1C1")["revision"]

    result = asyncio.run(
        orch.apply_change_set(
            "p",
            [
                {
                    "asset_type": "chapter",
                    "asset_id": "V1C1",
                    "original": "第一章。",
                    "revised": "第一章修改。",
                    "base_revision": first_revision,
                },
                {
                    "asset_type": "chapter",
                    "asset_id": "V1C2",
                    "original": "过期正文。",
                    "revised": "第二章修改。",
                    "base_revision": 0,
                },
            ],
        )
    )

    assert result["success"] is False and result["reason"] == "revision_conflict"
    assert asyncio.run(orch.draft_storage.get_final_draft("p", "V1C1")) == "第一章。"
    assert asyncio.run(orch.draft_storage.get_final_draft("p", "V1C2")) == "第二章。"


def test_apply_change_set_updates_existing_summary_word_count(tmp_path):
    from app.schemas.draft import ChapterSummary

    orch = _orch(tmp_path)
    asyncio.run(orch.draft_storage.save_current_draft("p", "V1C1", "旧文"))
    asyncio.run(
        orch.draft_storage.save_chapter_summary(
            "p",
            ChapterSummary(chapter="V1C1", volume_id="V1", title="第一章", word_count=999),
        )
    )
    revision = orch.draft_storage.get_draft_revision("p", "V1C1")["revision"]

    result = asyncio.run(
        orch.apply_change_set(
            "p",
            [
                {
                    "asset_type": "chapter",
                    "asset_id": "V1C1",
                    "original": "旧文",
                    "revised": "新的章节正文",
                    "base_revision": revision,
                }
            ],
        )
    )

    assert result["success"] is True
    summary = asyncio.run(orch.draft_storage.get_chapter_summary("p", "V1C1"))
    assert summary.word_count == len("新的章节正文")


def test_chat_turn_attaches_writing_memory_status_and_turn_context(tmp_path):
    orch = _orch(tmp_path)

    async def fake_decide(*_args, **_kwargs):
        return {"action": "write"}

    async def fake_agent(*_args, **_kwargs):
        return {
            "success": True,
            "action": "agentic_write",
            "changed": True,
            "content": "new chapter text",
            "context_supply": {
                "available": ["draft", "card"],
                "retrieved": ["canon"],
                "used": ["draft", "canon"],
                "omitted": [],
            },
        }

    orch.decide_writing_action = fake_decide
    orch.writing_service.run = fake_agent
    result = asyncio.run(orch.run_chat_turn("p", "V1C001", "write"))

    assert result["writing_memory"]["exists"] is False
    assert result["writing_memory"]["turn_context"]["used"] == ["draft", "canon"]


def test_chat_turn_passes_only_writing_service_contract_arguments(tmp_path):
    orch = _orch(tmp_path)

    async def fake_decide(*_args, **_kwargs):
        return {"action": "continue"}

    async def exact_service(
        pid,
        chapter,
        message,
        *,
        has_selection=False,
        thinking=False,
        target_word_count=3000,
        conversation_history=None,
        selection_text="",
    ):
        assert (pid, chapter, message) == ("p", "V1C001", "continue")
        assert has_selection is False
        assert thinking is False
        assert target_word_count == 180
        # C3：无选区时不注入 selection_text。
        assert selection_text == ""
        return {"success": True, "action": "agentic_write"}

    orch.decide_writing_action = fake_decide
    orch.writing_service.run = exact_service
    result = asyncio.run(
        orch.run_chat_turn("p", "V1C001", "continue", has_draft=True, target_word_count=180)
    )
    assert result["success"] is True


def test_chat_turn_loads_selected_conversation_history(tmp_path):
    orch = _orch(tmp_path)
    conversation = asyncio.run(orch.session_history.create_conversation("p", title="记忆"))
    conversation_id = conversation["id"]
    asyncio.run(
        orch.session_history.append(
            "p", {"role": "user", "content": "上一轮决定让林舟留在新城"}, conversation_id=conversation_id
        )
    )
    asyncio.run(
        orch.session_history.append(
            "p", {"role": "assistant", "content": "记住了这个设定。"}, conversation_id=conversation_id
        )
    )
    captured = {}

    async def fake_decide(*_args, **_kwargs):
        return {"action": "continue"}

    async def fake_service(*_args, **kwargs):
        captured.update(kwargs)
        return {"success": True, "action": "agentic_write"}

    orch.decide_writing_action = fake_decide
    orch.writing_service.run = fake_service
    result = asyncio.run(
        orch.run_chat_turn("p", "V1C001", "继续", conversation_id=conversation_id)
    )

    assert result["success"] is True
    assert [item["content"] for item in captured["conversation_history"]] == [
        "上一轮决定让林舟留在新城",
        "记住了这个设定。",
    ]


def test_chat_turn_forwards_explicit_reasoning_level(tmp_path):
    orch = _orch(tmp_path)
    captured = {}

    async def fake_decide(*_args, **_kwargs):
        return {"action": "continue"}

    async def fake_service(_pid, _chapter, _message, **kwargs):
        captured.update(kwargs)
        return {"success": True, "action": "agentic_write"}

    orch.decide_writing_action = fake_decide
    orch.writing_service.run = fake_service
    result = asyncio.run(orch.run_chat_turn("p", "V1C001", "continue", reasoning_level="max"))

    assert result["success"] is True
    assert captured["reasoning_level"] == "max"


def test_chat_turn_context_plan_includes_actual_ranking_trace(tmp_path):
    orch = _orch(tmp_path)

    async def fake_decide(*a, **k):
        return {"action": "write"}

    async def fake_agent(pid, ch, msg, **k):
        orch.select_engine._last_ranking_trace = {
            "query": "张三 李四",
            "fusion": "lexical",
            "top_results": [{"id": "F1", "score": 1.0}],
        }
        return {"success": True, "action": "agentic_write", "changed": True}

    orch.decide_writing_action = fake_decide
    orch.writing_service.run = fake_agent
    r = asyncio.run(orch.run_chat_turn("p", "V1C001", "写个新场景"))
    assert r["context_plan"]["ranking"]["actual"]["top_results"][0]["id"] == "F1"


@pytest.mark.parametrize(
    ("client_hint", "seed_draft", "expected"),
    [(True, False, False), (False, True, True)],
)
def test_chat_turn_uses_backend_draft_state_instead_of_client_hint(client_hint, seed_draft, expected, tmp_path):
    orch = _orch(tmp_path)
    if seed_draft:
        _seed_draft(orch)
    observed = []

    async def fake_decide(*_args, **kwargs):
        observed.append(kwargs["has_draft"])
        return {"action": "write"}

    async def fake_agent(*_args, **_kwargs):
        return {"success": True, "action": "agentic_write", "changed": True}

    orch.decide_writing_action = fake_decide
    orch.writing_service.run = fake_agent
    result = asyncio.run(orch.run_chat_turn("p", "V1C001", "request", has_draft=client_hint))

    assert result["success"] is True
    assert observed == [expected]


def test_chat_turn_routes_plan(tmp_path):
    """plan 仍走显式拆解（不进 agent 写作主循环）。"""
    orch = _orch(tmp_path)

    async def fake_decide(*a, **k):
        return {"action": "plan"}

    async def fake_create(pid, goal, **k):
        return {"id": "p1", "steps": []}

    orch.decide_writing_action = fake_decide
    orch.application.plans.create_plan = fake_create
    r = asyncio.run(orch.run_chat_turn("p", "V1C001", "在6-8章回收伏笔"))
    assert r["action"] == "plan" and r["plan"]["id"] == "p1"
    assert r["route_contract"]["path"] == "plan_workflow"
    assert r["context_plan"]["route_path"] == "plan_workflow"


def test_cancelled_plan_generation_does_not_revive_terminal_runtime(tmp_path):
    from app.context_engine.turn_scope import current_turn_scope

    orch = _orch(tmp_path)

    async def fake_decide(*_args, **_kwargs):
        return {"action": "plan"}

    async def fake_create(*_args, **_kwargs):
        current_turn_scope().cancel()
        return None

    orch.decide_writing_action = fake_decide
    orch.application.plans.create_plan = fake_create
    result = asyncio.run(orch.run_chat_turn("p", "V1C001", "规划后续章节"))

    assert result["terminal_state"] == "cancelled"
    assert result["runtime"]["state"] == "cancelled"
    assert result["reason"] == "turn_cancelled"


def test_new_turn_scope_is_not_poisoned_by_legacy_session_cancel_flag(tmp_path):
    from app.context_engine.turn_scope import bind_turn_scope, new_turn_scope

    orch = _orch(tmp_path)
    orch.cancel_session()
    scope = new_turn_scope(project_id="p", chapter_id="V1C001")

    with bind_turn_scope(scope):
        assert orch.writing_service.is_cancelled() is False
        scope.cancel()
        assert orch.writing_service.is_cancelled() is True


def test_chat_turn_auto_execute_plan(tmp_path):
    orch = _orch(tmp_path)

    async def fake_decide(*a, **k):
        return {"action": "plan"}

    async def fake_create(pid, goal, **k):
        return {"id": "p1", "steps": []}

    async def fake_exec(pid, plan_id, **k):
        return {"success": True, "plan": {"status": "done"}}

    orch.decide_writing_action = fake_decide
    orch.application.plans.create_plan = fake_create
    orch.application.plans.execute_plan = fake_exec
    r = asyncio.run(orch.run_chat_turn("p", "V1C001", "在6-8章回收", auto_execute_plan=True))
    assert r["action"] == "plan" and r["execution"]["success"]
    assert "permission_gate" in [s["stage"] for s in r["route_contract"]["stages"]]


# ---------- run_writing_agent（阶段 C 核心：agent 自主用写作工具） ----------


class _AgentGateway:
    """Fake gateway：第 1 轮写正文，第 2 轮调用 finish_turn 收尾。"""

    def get_provider_for_agent(self, name):
        return "fake"

    async def chat(self, messages, provider=None, temperature=None, max_tokens=None, *, tools=None, **kwargs):
        if any(m.get("role") == "tool" for m in messages):
            return {
                "content": None,
                "tool_calls": [
                    {
                        "id": "f1",
                        "type": "function",
                        "name": "finish_turn",
                        "arguments": (
                            '{"change_type":"chapter_write","fact_operation":"replace_chapter",'
                            '"chapter_summary":"夜色降临。","fact_candidates":[],'
                            '"message":"已完成本章。"}'
                        ),
                    }
                ],
                "usage": {},
                "model": "fake",
                "finish_reason": "tool_calls",
            }
        return {
            "content": None,
            "tool_calls": [
                {"id": "w1", "type": "function", "name": "write_content", "arguments": '{"chapter_id":"V1C001","content":"夜色四合。"}'}
            ],
            "usage": {},
            "model": "fake",
            "finish_reason": "tool_calls",
        }


class _NoToolGateway:
    """Fake gateway：provider 不调任何工具，单 Writer 应明确返回 incomplete。"""

    def get_provider_for_agent(self, name):
        return "fake"

    async def chat(self, messages, provider=None, temperature=None, max_tokens=None, *, tools=None, **kwargs):
        return {"content": "（直接回答，未调工具）", "tool_calls": None, "usage": {}, "model": "fake", "finish_reason": "stop"}


class _RepeatedEditGateway:
    """每轮都继续请求编辑，模拟已修改正文但达到迭代上限。"""

    def get_provider_for_agent(self, name):
        return "fake"

    async def chat(self, messages, provider=None, temperature=None, max_tokens=None, *, tools=None, **kwargs):
        return {
            "content": None,
            "tool_calls": [
                {"id": "e1", "type": "function", "name": "edit_lines", "arguments": '{"chapter_id":"V1C001","old_text":"夜色","new_text":"暮色"}'}
            ],
            "usage": {},
            "model": "fake",
            "finish_reason": "tool_calls",
        }


class _EmptyDraft:
    async def list_draft_versions(self, pid, ch):
        return []

    async def get_draft(self, pid, ch, v):
        return None


def test_run_writing_agent_writes_and_streams(tmp_path):
    """agent 调 write_content → working_text 变 → 推 stream_start/stream_end + 返回 agentic_write。"""
    orch = _orch(tmp_path)
    events = []

    async def _cb(payload):
        events.append(payload.get("type"))

    async def _no_proposals(pid, text):
        return []

    orch.writing_service.gateway = _AgentGateway()
    orch.writing_service.draft_storage = _EmptyDraft()
    orch.writing_service.progress_callback = _cb
    orch.writing_service.detect_proposals = _no_proposals
    r = asyncio.run(orch.writing_service.run("p", "V1C001", "写第一章"))
    assert r["success"] and r["action"] == "agentic_write" and r["changed"] is True
    assert r["content"] == "夜色四合。"
    assert "stream_start" in events and "stream_end" in events  # WS 流式 diff 已推送


def test_run_writing_agent_is_incomplete_when_no_tool_calls(tmp_path):
    """Provider 未调工具时不得切换旧 workflow。"""
    orch = _orch(tmp_path)
    orch.writing_service.gateway = _NoToolGateway()
    orch.writing_service.draft_storage = _EmptyDraft()
    r = asyncio.run(orch.writing_service.run("p", "V1C001", "写第一章"))
    assert r["success"] is False
    assert r["incomplete"] is True
    assert r["terminal_state"] == "incomplete"


def test_run_writing_agent_delivers_changed_text_at_iteration_limit(tmp_path):
    orch = _orch(tmp_path)
    events = []

    class _Draft:
        async def get_working_text(self, _pid, _chapter):
            return "夜色四合。", None

    async def _cb(payload):
        events.append(payload.get("type"))

    orch.writing_service.gateway = _RepeatedEditGateway()
    orch.writing_service.draft_storage = _Draft()
    orch.writing_service.progress_callback = _cb
    orch.writing_service.detect_proposals = None

    result = asyncio.run(orch.writing_service.run("p", "V1C001", "把夜色改成暮色"))

    assert result["success"] is True
    assert result["changed"] is True
    assert result["partial"] is True
    assert result["reason"] == "max_iterations"
    assert result["content"] == "暮色四合。"
    assert "stream_end" in events


# ---------- V1-4 温度口径统一 / temperature single owner ----------


class _TemperatureProbeGateway:
    """记录实际下发给 provider 的温度，并暴露 profile 温度。"""

    def __init__(self, profile_temperature=0.35, *, supports_temperature=True):
        self.profile_temperature = profile_temperature
        self.supports_temperature = supports_temperature
        self.seen_temperatures = []

    def get_provider_for_agent(self, _name):
        return "fake"

    def get_temperature_for_agent(self, _name):
        if not self.supports_temperature:
            raise RuntimeError("no_profile")
        return self.profile_temperature

    async def chat(self, messages, **kwargs):
        self.seen_temperatures.append(kwargs.get("temperature"))
        return {
            "content": "已完成。",
            "tool_calls": [],
            "usage": {},
            "model": "fake",
            "finish_reason": "stop",
        }


def _assemble_writer_request():
    from app.orchestrator.context_assembly_service import ContextAssemblyService

    return ContextAssemblyService().assemble_writer_request(
        message="写一段对白",
        chapter="V1C001",
        current_text="",
        has_selection=False,
        target_word_count=800,
    )


def test_assembly_does_not_decide_temperature():
    """
    装配阶段不再硬编码 0.7。

    ContextAssemblyService 是无 I/O 的纯装配（可确定性重放），而温度属于 provider
    profile；在此写死会让用户在 UI 改的温度静默失效。
    """
    assert _assemble_writer_request().temperature is None


def test_payload_and_writer_request_stay_in_sync():
    """
    payload 与 WriterRequest 必须同源构造。

    payload 参与 assembly fingerprint 计算，WriterRequest 是实际下发值；两者各写一份
    会随时间分叉，导致 trace 里的 fingerprint 与真实请求不一致（5 处消费该 fingerprint）。
    """
    request = _assemble_writer_request()
    # 同一份装配重复执行必须得到一致的 fingerprint 与字段（确定性重放）
    again = _assemble_writer_request()
    assert request.fingerprint == again.fingerprint
    assert request.temperature == again.temperature
    assert request.max_tokens == again.max_tokens
    assert request.max_iterations == again.max_iterations


def test_agents_config_section_removed_and_unconsumed():
    """
    config.yaml 的 agents 段已删除，且全仓无消费点。

    该段曾声明 provider/temperature 但从未被读取——用户改了不生效。真正的单一 owner
    是「LLM profile + agent 分配」（gateway.get_provider_for_agent / get_temperature_for_agent）。
    """
    from app.config import config

    assert "agents" not in config, "agents 段应保持删除；温度/provider 由 LLM profile 决定"


def test_gateway_port_declares_temperature_owner():
    """GatewayPort 契约显式声明温度解析方法，避免调用方各自 getattr 猜测。"""
    from app.orchestrator.runtime_contracts import GatewayPort

    assert hasattr(GatewayPort, "get_temperature_for_agent")
