# -*- coding: utf-8 -*-
"""
文枢 WenShape - 深度上下文感知的智能体小说创作系统
WenShape - Deep Context-Aware Agent-Based Novel Writing System

Copyright © 2025-2026 WenShape Team
License: PolyForm Noncommercial License 1.0.0

模块说明 / Module Description:
  C4 Provider 总窗口合同测试 - 精确计数时输入 + 请求输出不得超出 Provider
  总窗口；估算路径保持显式软目标降级（评估报告 §6.1：输入软目标与输出
  reserve 分离检查，input=3500 + reserve=1024 的 4096 窗口组合曾被接受）。
  C4 provider total-window contract tests - with exact token counting,
  input + requested output must not exceed the provider total window;
  estimated paths keep an explicit soft-overflow degradation (§6.1).
"""

import pytest

from app.context_engine.context_plan import ContextPlanV2


def _plan(*, context_limit: int, total_window: int, input_tokens: int, output_reserve: int):
    return ContextPlanV2(
        plan_id="ctx_test",
        turn_id="t1",
        project_id="p1",
        chapter_id="V1C1",
        intent="write",
        route_path="agentic_writer",
        context_epoch="0",
        budget={
            "context_limit_tokens": context_limit,
            "total_window_tokens": total_window,
            "input_tokens": input_tokens,
            "output_reserve_tokens": output_reserve,
        },
        tool_loadout=[],
        policy={"source_closure_required": False},
        sources=[],
    )


def _validate(plan, *, input_tokens: int, max_tokens: int, exact: bool = True):
    return plan.validate_request(
        messages=[{"role": "user", "content": "x"}],
        provider=None,
        temperature=0.5,
        max_tokens=max_tokens,
        tools=None,
        token_accounting={
            "tokens": input_tokens,
            "upper_bound_tokens": int(input_tokens * 1.35),
            "exact": exact,
        },
    )


class TestTotalWindowContract:
    """§6.1 探针：4096 窗口、input 3500 + 输出 1024。"""

    def test_exact_counting_over_total_window_rejected(self):
        """精确计数下 input+output > 总窗口必须拒绝（旧实现只查输入、被接受）。"""
        plan = _plan(context_limit=4096, total_window=4096, input_tokens=3072, output_reserve=1024)
        with pytest.raises(ValueError, match="context_total_window_exceeded"):
            _validate(plan, input_tokens=3500, max_tokens=1024, exact=True)

    def test_within_total_window_accepted(self):
        """边界内组合正常通过（不制造普遍误拦）。"""
        plan = _plan(context_limit=4096, total_window=4096, input_tokens=3072, output_reserve=1024)
        record = _validate(plan, input_tokens=3000, max_tokens=1024, exact=True)
        assert record["planned"] is True

    def test_estimated_path_degrades_not_blocks(self):
        """估算路径（exact=False）不拦截，但必须显式记录 total_window_soft_overflow。"""
        plan = _plan(context_limit=4096, total_window=4096, input_tokens=3072, output_reserve=1024)
        record = _validate(plan, input_tokens=3500, max_tokens=1024, exact=False)
        overflows = [d for d in record.get("degradation") or [] if d.get("type") == "total_window_soft_overflow"]
        assert overflows, "估算超窗必须显式降级记录（不得静默携带）"
        assert overflows[0]["total_window_tokens"] == 4096
        assert overflows[0]["requested_output_tokens"] == 1024

    def test_no_output_request_skips_total_check(self):
        """未请求输出（max_tokens 空）时无总量可算——不触发总窗口分支。"""
        plan = _plan(context_limit=4096, total_window=4096, input_tokens=3072, output_reserve=1024)
        record = plan.validate_request(
            messages=[{"role": "user", "content": "x"}],
            provider=None,
            temperature=0.5,
            max_tokens=None,
            tools=None,
            token_accounting={"tokens": 3900, "upper_bound_tokens": 5200, "exact": True},
        )
        assert record["planned"] is True

    def test_input_only_overflow_still_hard_fails(self):
        """纯输入超窗口仍走既有硬失败（不因 C4 改动回归）。"""
        plan = _plan(context_limit=4096, total_window=4096, input_tokens=3072, output_reserve=1024)
        with pytest.raises(ValueError, match="context_budget_exceeded"):
            _validate(plan, input_tokens=5000, max_tokens=512, exact=True)
