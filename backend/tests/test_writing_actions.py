# -*- coding: utf-8 -*-
"""
Phase B 验收：写作动作工具集（write_content / edit_lines / finish_turn）。
纯字符串操作、无网络、无 LLM；agentic loop 段用 Fake gateway 验证 agent 自主调用写作工具。
"""

import asyncio

from app.agents.writing_actions import (
    WritingActionToolset,
    normalize_clarification_questions,
    writing_action_schemas,
)
from app.agents.agentic import run_agentic_chat


# ----------------------------------------------------------- Schema tests --


def test_schemas_cover_write_and_edit():
    names = {s["function"]["name"] for s in writing_action_schemas()}
    assert names == {"ask_clarification", "create_chapter", "write_content", "edit_lines", "finish_turn"}
    schema = next(s["function"] for s in writing_action_schemas() if s["function"]["name"] == "ask_clarification")
    questions = schema["parameters"]["properties"]["questions"]
    assert questions["minItems"] == 1
    assert questions["maxItems"] == 3


def test_toolset_schemas_without_retrieval():
    names = {s["function"]["name"] for s in WritingActionToolset("").schemas()}
    assert names == {"ask_clarification", "create_chapter", "write_content", "edit_lines", "finish_turn"}


def test_clarification_question_count_is_model_selected_and_bounded():
    for count in (1, 2, 3):
        questions = normalize_clarification_questions([{"text": f"问题 {index}"} for index in range(count)])
        assert len(questions) == count
    bounded = normalize_clarification_questions([{"text": f"问题 {index}"} for index in range(4)])
    assert len(bounded) == 3


def test_clarification_questions_are_deduplicated_without_inventing_text():
    questions = normalize_clarification_questions(
        [
            {"text": "这场冲突如何收束？"},
            {"text": " 这场冲突如何收束？ "},
            {"text": "主角继续使用第一人称吗？"},
        ]
    )

    assert [item["text"] for item in questions] == ["这场冲突如何收束？", "主角继续使用第一人称吗？"]


def test_ask_clarification_pauses_before_writing_and_blocks_followup_actions():
    tools = WritingActionToolset("旧正文")
    result = asyncio.run(
        tools.execute(
            "ask_clarification",
            {
                "questions": [
                    {"text": "这次冲突应公开爆发还是暂时压下？", "reason": "决定场景收束方式"},
                    {"text": "本章视角继续跟随林舟吗？"},
                ]
            },
        )
    )

    assert "2 个反问" in result
    assert tools.input_required is True
    assert len(tools.input_required_payload()["questions"]) == 2
    blocked = asyncio.run(tools.execute("write_content", {"content": "不应写入"}))
    assert "clarification_pending" in blocked
    assert tools.working_text == "旧正文"


def test_ask_clarification_is_rejected_after_prose_change():
    tools = WritingActionToolset("旧正文")
    asyncio.run(tools.execute("write_content", {"content": "新正文"}))
    result = asyncio.run(tools.execute("ask_clarification", {"questions": [{"text": "还要改吗？"}]}))
    assert "clarification_must_precede_writing" in result
    assert tools.input_required is False


def test_ask_clarification_is_rejected_after_chapter_targeting():
    tools = WritingActionToolset(
        "",
        existing_chapters=["V1C1"],
        require_chapter_target=True,
    )
    asyncio.run(tools.execute("create_chapter", {"title": "新章"}))

    result = asyncio.run(tools.execute("ask_clarification", {"questions": [{"text": "本章要用谁的视角？"}]}))

    assert "clarification_must_precede_writing" in result
    assert tools.input_required is False


def test_finish_turn_normalizes_terminal_payload():
    ts = WritingActionToolset("旧正文")
    asyncio.run(ts.execute("edit_lines", {"old_text": "旧", "new_text": "新"}))
    asyncio.run(
        ts.execute(
            "finish_turn",
            {
                "change_type": "plot_edit",
                "fact_operation": "merge",
                "chapter_summary": "剧情发生变化。",
                "fact_candidates": [
                    {"statement": "主角改变决定", "evidence": "新正文", "category": "人物状态"}
                ],
                "message": "已完成修改。",
            },
        )
    )

    assert ts.has_terminal_payload is True
    assert ts.terminal_payload() == {
        "change_type": "plot_edit",
        "fact_operation": "merge",
        "chapter_summary": "剧情发生变化。",
        "fact_candidates": [
            {"statement": "主角改变决定", "evidence": "新正文", "category": "人物状态"}
        ],
        "message": "已完成修改。",
    }


# ---------------------------------------------------------- write_content --


def test_create_chapter_proposes_next_id_without_persisting():
    ts = WritingActionToolset(
        "旧章正文",
        active_chapter="V1C3",
        existing_chapters=["V1C1", "V1C2", "V1C3"],
        require_chapter_target=True,
    )

    out = asyncio.run(ts.execute("create_chapter", {"title": "归途"}))

    assert "V1C4" in out
    assert ts.chapter_target() == {"chapter": "V1C4", "title": "归途", "create": True}
    assert ts.working_text == ""


def test_write_requires_chapter_target_when_runtime_enforces_it():
    ts = WritingActionToolset("", require_chapter_target=True)
    out = asyncio.run(ts.execute("write_content", {"content": "正文"}))
    assert "create_chapter" in out
    assert ts.changed is False


def test_write_content_replace_on_empty():
    ts = WritingActionToolset("")
    out = asyncio.run(ts.execute("write_content", {"content": "第一章 风起"}))
    assert "写入" in out
    assert ts.working_text == "第一章 风起"
    assert ts.changed is True


def test_write_content_replace_overwrites():
    ts = WritingActionToolset("旧正文")
    asyncio.run(ts.execute("write_content", {"content": "全新正文", "mode": "replace"}))
    assert ts.working_text == "全新正文"


def test_write_content_append_keeps_existing():
    ts = WritingActionToolset("第一段。")
    out = asyncio.run(ts.execute("write_content", {"content": "第二段。", "mode": "append"}))
    assert "追加" in out
    assert ts.working_text == "第一段。\n\n第二段。"


def test_write_content_append_on_empty_falls_back_to_replace():
    ts = WritingActionToolset("")
    asyncio.run(ts.execute("write_content", {"content": "首段", "mode": "append"}))
    assert ts.working_text == "首段"


def test_write_content_empty_is_rejected():
    ts = WritingActionToolset("原文")
    out = asyncio.run(ts.execute("write_content", {"content": "   "}))
    assert "需要非空" in out
    assert ts.working_text == "原文"  # 未改动


# ------------------------------------------------------------- edit_lines --


def test_edit_lines_unique_replace():
    ts = WritingActionToolset("张三走进迷雾森林，四下张望。")
    out = asyncio.run(ts.execute("edit_lines", {"old_text": "四下张望", "new_text": "屏息凝神"}))
    assert "已替换" in out
    assert ts.working_text == "张三走进迷雾森林，屏息凝神。"


def test_edit_lines_delete_with_empty_new():
    ts = WritingActionToolset("多余的话。正文。")
    asyncio.run(ts.execute("edit_lines", {"old_text": "多余的话。", "new_text": ""}))
    assert ts.working_text == "正文。"


def test_edit_lines_not_found():
    ts = WritingActionToolset("正文")
    out = asyncio.run(ts.execute("edit_lines", {"old_text": "不存在", "new_text": "x"}))
    assert "未找到" in out
    assert ts.changed is False


def test_edit_lines_not_unique_refuses():
    ts = WritingActionToolset("猫。猫。")
    out = asyncio.run(ts.execute("edit_lines", {"old_text": "猫。", "new_text": "狗。"}))
    assert "不唯一" in out
    assert ts.working_text == "猫。猫。"  # 不唯一 → 不替换，保稳


def test_edit_lines_missing_old_text():
    out = asyncio.run(WritingActionToolset("x").execute("edit_lines", {"new_text": "y"}))
    assert "需要 old_text" in out


# ------------------------------------------------------- retrieval 组合 --


class _FakeRetrieval:
    def schemas(self):
        return [{"type": "function", "function": {"name": "query_canon", "parameters": {}}}]

    async def execute(self, name, arguments):
        return f"[检索结果:{name}]"


def test_schemas_merge_retrieval_then_writing():
    ts = WritingActionToolset("", retrieval_toolset=_FakeRetrieval())
    names = [s["function"]["name"] for s in ts.schemas()]
    assert names == [
        "query_canon",
        "ask_clarification",
        "create_chapter",
        "write_content",
        "edit_lines",
        "finish_turn",
    ]  # 检索在前，便于先查后写


def test_execute_delegates_unknown_to_retrieval():
    ts = WritingActionToolset("", retrieval_toolset=_FakeRetrieval())
    out = asyncio.run(ts.execute("query_canon", {"query": "x"}))
    assert "检索结果" in out


def test_unknown_tool_graceful_without_retrieval():
    out = asyncio.run(WritingActionToolset("").execute("no_such", {}))
    assert "未知工具" in out


# ---------------------------------------------------- agentic loop 集成 --


class _WritingLoopGateway:
    """先写正文，再尝试直接结束，最后按合同调用 finish_turn。"""

    def __init__(self):
        self.n = 0

    async def chat(
        self, messages, provider=None, temperature=None, max_tokens=None, retry=True, *, tools=None, **kwargs
    ):
        self.n += 1
        if self.n == 1:
            return {
                "content": None,
                "tool_calls": [
                    {
                        "id": "w1",
                        "type": "function",
                        "name": "write_content",
                        "arguments": '{"content":"夜色四合，张三独自上路。"}',
                    }
                ],
                "usage": {},
                "model": "fake",
                "finish_reason": "tool_calls",
            }
        if self.n == 2:
            return {
                "content": "已完成本章初稿。",
                "tool_calls": None,
                "usage": {},
                "model": "fake",
                "finish_reason": "stop",
            }
        return {
            "content": None,
            "tool_calls": [
                {
                    "id": "f1",
                    "type": "function",
                    "name": "finish_turn",
                    "arguments": (
                        '{"change_type":"chapter_write","fact_operation":"replace_chapter",'
                        '"chapter_summary":"张三在夜色中独自上路。","fact_candidates":[],'
                        '"message":"已完成本章初稿。"}'
                    ),
                }
            ],
            "usage": {},
            "model": "fake",
            "finish_reason": "tool_calls",
        }


def test_agent_autonomously_writes_via_tool():
    gw = _WritingLoopGateway()
    ts = WritingActionToolset("")
    resp = asyncio.run(run_agentic_chat(gw, "fake", [{"role": "user", "content": "写第一章"}], ts, max_iterations=3))
    assert resp["content"] == "已完成本章初稿。"
    assert resp["terminal_payload"]["change_type"] == "chapter_write"
    assert gw.n == 3
    assert ts.working_text == "夜色四合，张三独自上路。"  # agent 自主生成的正文已落入工作副本
    assert ts.changed is True


class _ClarificationGateway:
    async def chat(self, _messages, **_kwargs):
        return {
            "content": None,
            "tool_calls": [
                {
                    "id": "ask-1",
                    "type": "function",
                    "name": "ask_clarification",
                    "arguments": '{"questions":[{"text":"要让主角在本章暴露身份吗？"}]}',
                },
                {
                    "id": "write-1",
                    "type": "function",
                    "name": "write_content",
                    "arguments": '{"content":"这段不应执行。"}',
                },
            ],
            "usage": {},
            "model": "fake",
            "finish_reason": "tool_calls",
        }


def test_agentic_loop_stops_same_batch_after_clarification_tool():
    tools = WritingActionToolset("")
    response = asyncio.run(
        run_agentic_chat(
            _ClarificationGateway(),
            "fake",
            [{"role": "user", "content": "写这一章"}],
            tools,
            max_iterations=1,
        )
    )

    assert response.incomplete is True
    assert response.finish_reason == "clarification_requested"
    assert len(response["questions"]) == 1
    assert len(response.tool_results) == 1
    assert tools.working_text == ""


class _ReversedClarificationGateway:
    async def chat(self, _messages, **_kwargs):
        return {
            "content": None,
            "tool_calls": [
                {
                    "id": "write-1",
                    "type": "function",
                    "name": "write_content",
                    "arguments": '{"content":"这段不应执行。"}',
                },
                {
                    "id": "ask-1",
                    "type": "function",
                    "name": "ask_clarification",
                    "arguments": '{"questions":[{"text":"要让主角在本章暴露身份吗？"}]}',
                },
            ],
            "usage": {},
            "model": "fake",
            "finish_reason": "tool_calls",
        }


def test_input_request_dominates_same_batch_even_when_provider_orders_write_first():
    tools = WritingActionToolset("")
    response = asyncio.run(
        run_agentic_chat(
            _ReversedClarificationGateway(),
            "fake",
            [{"role": "user", "content": "写这一章"}],
            tools,
            max_iterations=1,
        )
    )

    assert response.incomplete is True
    assert response.finish_reason == "clarification_requested"
    assert [result.tool_name for result in response.tool_results] == ["ask_clarification"]
    assert tools.working_text == ""


# ------------------------------------------ V2-1 edit_lines 分层 fallback --


def _edit(prose, old, new="替换后"):
    ts = WritingActionToolset(prose)
    out = asyncio.run(ts.execute("edit_lines", {"old_text": old, "new_text": new}))
    return ts, out


_PROSE = "林清越推开门，看见桌上放着一封信。\n她犹豫片刻，还是拆开了。"


def test_edit_lines_tolerates_halfwidth_punctuation():
    """模型把「。」写成「.」——中文场景最高频的复述偏移。"""
    ts, out = _edit(_PROSE, "看见桌上放着一封信.")
    assert "已替换" in out and "标点归一化" in out
    assert ts.working_text == "林清越推开门，替换后\n她犹豫片刻，还是拆开了。"


def test_edit_lines_tolerates_extra_whitespace():
    """模型在半角逗号后多打空格；原文此处无空白，游程折叠救不了，须靠末层。"""
    ts, out = _edit(_PROSE, "林清越推开门, 看见桌上放着一封信。")
    assert "已替换" in out and "忽略空白" in out
    assert ts.working_text == "替换后\n她犹豫片刻，还是拆开了。"


def test_edit_lines_tolerates_line_indentation():
    """模型复述整段时带上缩进。"""
    ts, out = _edit(_PROSE, "  林清越推开门，看见桌上放着一封信。\n  她犹豫片刻，还是拆开了。")
    assert "已替换" in out
    assert ts.working_text == "替换后"


def test_edit_lines_fallback_preserves_original_formatting():
    """
    这是分层匹配的核心不变量：归一化只用于「定位」，替换落在**原文精确区间**上。

    若直接在归一化文本上替换，会把原文的全角标点/换行一并改写——用户会看到
    自己没要求的格式变更。此处断言未被替换的部分逐字未变。
    """
    ts, _ = _edit(_PROSE, "看见桌上放着一封信.", new="收到一张字条。")
    # 第一句的全角逗号、第二行的换行与全角标点都必须原样保留
    assert ts.working_text == "林清越推开门，收到一张字条。\n她犹豫片刻，还是拆开了。"


def test_edit_lines_fallback_still_requires_unique_match():
    """
    放宽匹配不等于放弃唯一性——不为了「匹配上」牺牲定位安全。

    old_text 用全角句号「他说。」，正文两处都是半角「他说.」：精确层不命中，
    到标点归一化层两处塌缩为同一串 → 必须拒绝，而不是随便改一处。
    """
    ts, out = _edit("他说. 他说.", "他说。")
    assert "不唯一" in out
    assert ts.working_text == "他说. 他说."  # 未改动


def test_edit_lines_prefers_exact_match_over_ambiguous_fallback():
    """
    精确逐字命中优先于「更宽层里看起来有歧义」。

    "他说。他说." 中查 "他说."：精确层唯一命中第二处，是最强证据，应当直接采用；
    若因标点归一化后有两个候选就拒绝，反而会否掉一次完全确定的编辑。
    """
    ts, out = _edit("他说。他说.", "他说.", new="X")
    assert "已替换" in out
    assert ts.working_text == "他说。X"


def test_edit_lines_exact_match_reports_no_fallback_hint():
    """精确命中不应出现「经…定位」提示，避免给模型无谓噪声。"""
    ts, out = _edit(_PROSE, "看见桌上放着一封信。")
    assert "已替换" in out and "定位）" not in out


def test_edit_lines_records_match_layer_for_diagnostics():
    """命中层级进入 actions，便于诊断模型的偏移模式（对齐 record_edit_miss 的观测意图）。"""
    ts, _ = _edit(_PROSE, "看见桌上放着一封信.")
    edits = [a for a in ts.actions if a.get("action") == "edit"]
    assert edits and edits[0]["match_layer"] == "punctuation"


def test_edit_lines_still_rejects_truly_absent_text():
    """放宽后仍必须拒绝真正不存在的文本，不能退化成模糊匹配。"""
    ts, out = _edit(_PROSE, "这段话根本不在正文里")
    assert "未找到" in out
    assert ts.changed is False


# ------------------------------------------ V2-2 重复调用检测（doom loop）--


class _RepeatingEditGateway:
    """模拟 doom loop：反复用同一个不存在的 old_text 调 edit_lines，最后收尾。"""

    def __init__(self, repeats=3):
        self.repeats = repeats
        self.n = 0
        self.tool_messages = []

    async def chat(
        self, messages, provider=None, temperature=None, max_tokens=None, retry=True, *, tools=None, **kwargs
    ):
        # 记录回灌给模型的消息，用于断言提示是否真的送达
        for m in messages:
            text = str(m.get("content") or "")
            if m.get("role") in {"tool", "user"} and text not in self.tool_messages:
                self.tool_messages.append(text)
        self.n += 1
        if self.n <= self.repeats:
            return {
                "content": None,
                "tool_calls": [
                    {
                        "id": f"e{self.n}",
                        "type": "function",
                        "name": "edit_lines",
                        "arguments": '{"old_text":"根本不存在的句子","new_text":"x"}',
                    }
                ],
                "usage": {},
                "model": "fake",
                "finish_reason": "tool_calls",
            }
        return {
            "content": None,
            "tool_calls": [
                {"id": "f1", "type": "function", "name": "finish_turn", "arguments": "{}"}
            ],
            "usage": {},
            "model": "fake",
            "finish_reason": "tool_calls",
        }


def _run_repeat_loop(repeats=3):
    gateway = _RepeatingEditGateway(repeats=repeats)
    ts = WritingActionToolset("正文内容。")
    result = asyncio.run(
        run_agentic_chat(gateway, "fake", [{"role": "user", "content": "改一句"}], ts, max_iterations=8)
    )
    return gateway, ts, result


def test_repeated_identical_call_gets_strategy_hint():
    """
    同一 (工具, 参数) 第 2 次调用起，结果尾部追加换策略提示并送达模型。

    判据取「重复调用」而非「失败次数」：edit_lines 未命中走的是正常返回（非 tool_error），
    按失败计数恰好漏掉 doom loop 最典型的形态。
    """
    gateway, _, _ = _run_repeat_loop(repeats=3)
    hinted = [t for t in gateway.tool_messages if "[repeated_call]" in t]
    assert hinted, "重复调用应产生提示"
    assert "换一种做法" in hinted[0]
    assert "finish_turn" in hinted[0]


def test_first_call_has_no_hint():
    """首次调用不提示——避免给正常的一次性工具调用制造噪声。"""
    gateway, _, _ = _run_repeat_loop(repeats=1)
    assert not [t for t in gateway.tool_messages if "[repeated_call]" in t]


def test_repeat_hint_does_not_contaminate_tool_output():
    """
    提示作为独立消息回灌，**不混入工具结果本身**。

    工具输出必须原样进入 artifact 与哈希、并由 gateway 单独负责折叠
    （test_agentic_metabolism 冻结了这条契约）；把提示拼进 output 会破坏它。
    """
    gateway, _, _ = _run_repeat_loop(repeats=3)
    tool_outputs = [t for t in gateway.tool_messages if t.startswith("未找到要替换的文本")]
    assert tool_outputs, "应有 edit_lines 的原始输出"
    assert all("[repeated_call]" not in t for t in tool_outputs)


def test_repeat_detection_does_not_interrupt_the_loop():
    """
    只提示、不中断：先把换策略的机会交还模型，保留其自主性。

    终态语义不变——仍由 AgentRunResult 四态表达，不因重复检测新增第五态。
    """
    _, _, result = _run_repeat_loop(repeats=3)
    assert result["status"] in {"completed", "incomplete"}
    assert result["status"] != "failed"


def test_distinct_arguments_are_not_treated_as_repeats():
    """参数不同即视为新尝试，不应误报——重复检测必须零误报才敢默认开启。"""

    class _VaryingGateway(_RepeatingEditGateway):
        async def chat(self, messages, provider=None, temperature=None, max_tokens=None, retry=True, *, tools=None, **kwargs):
            for m in messages:
                text = str(m.get("content") or "")
                if m.get("role") in {"tool", "user"} and text not in self.tool_messages:
                    self.tool_messages.append(text)
            self.n += 1
            if self.n <= 2:
                return {
                    "content": None,
                    "tool_calls": [
                        {
                            "id": f"v{self.n}",
                            "type": "function",
                            "name": "edit_lines",
                            "arguments": '{"old_text":"缺失片段%d","new_text":"x"}' % self.n,
                        }
                    ],
                    "usage": {}, "model": "fake", "finish_reason": "tool_calls",
                }
            return {
                "content": None,
                "tool_calls": [{"id": "f1", "type": "function", "name": "finish_turn", "arguments": "{}"}],
                "usage": {}, "model": "fake", "finish_reason": "tool_calls",
            }

    gateway = _VaryingGateway()
    ts = WritingActionToolset("正文内容。")
    asyncio.run(run_agentic_chat(gateway, "fake", [{"role": "user", "content": "改"}], ts, max_iterations=8))
    assert not [t for t in gateway.tool_messages if "[repeated_call]" in t]


# ---------------------------------------------------- V2-3 迭代预算语义 --


class _NudgeThenFinishGateway:
    """先若干轮「只说话不调工具」触发协议性催促，再正常收尾。"""

    def __init__(self, nudges=3):
        self.nudges = nudges
        self.n = 0

    async def chat(
        self, messages, provider=None, temperature=None, max_tokens=None, retry=True, *, tools=None, **kwargs
    ):
        self.n += 1
        if self.n <= self.nudges:
            return {
                "content": "我来解释一下我的思路……",
                "tool_calls": [],
                "usage": {}, "model": "fake", "finish_reason": "stop",
            }
        return {
            "content": None,
            "tool_calls": [{"id": "f1", "type": "function", "name": "finish_turn", "arguments": "{}"}],
            "usage": {}, "model": "fake", "finish_reason": "tool_calls",
        }


def test_protocol_nudge_does_not_consume_iteration_budget():
    """
    协议性催促（该收尾却没调 finish_turn）不扣预算。

    那是合同开销、不是工作进展；让它吃掉预算会把「差一步就完成」直接推成 incomplete
    （report.md §4.4 的 6 轮推演即此场景）。预算仅 2，却经历 3 次催促后仍应完成。
    """
    gateway = _NudgeThenFinishGateway(nudges=3)
    ts = WritingActionToolset("正文。")
    result = asyncio.run(
        run_agentic_chat(gateway, "fake", [{"role": "user", "content": "改"}], ts, max_iterations=2)
    )
    assert result["status"] == "completed"


def test_endless_nudging_still_terminates_without_pretending_success():
    """
    催促不计预算，但不能变成无限循环：硬上限兜底，且终态必须是 incomplete。

    「没做完」绝不伪装成 completed（§4 固定不变量）。
    """
    gateway = _NudgeThenFinishGateway(nudges=10**6)  # 永不收尾
    ts = WritingActionToolset("正文。")
    result = asyncio.run(
        run_agentic_chat(gateway, "fake", [{"role": "user", "content": "改"}], ts, max_iterations=2)
    )
    assert result["status"] == "incomplete"
    assert result.get("finish_reason") == "terminal_tool_never_called"


def test_real_work_still_consumes_budget():
    """实质轮次照常计费——不计费的只有协议性催促这一种。"""
    gateway = _RepeatingEditGateway(repeats=10**6)  # 一直调工具，从不收尾
    ts = WritingActionToolset("正文。")
    result = asyncio.run(
        run_agentic_chat(gateway, "fake", [{"role": "user", "content": "改"}], ts, max_iterations=3)
    )
    assert result["status"] == "incomplete"
    assert result.get("finish_reason") == "max_iterations"
