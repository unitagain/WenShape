# -*- coding: utf-8 -*-
"""
文枢 WenShape - 深度上下文感知的智能体小说创作系统
WenShape - Deep Context-Aware Agent-Based Novel Writing System

Copyright © 2025-2026 WenShape Team
License: PolyForm Noncommercial License 1.0.0

模块说明 / Module Description:
  Phase 11 · 写作任务规划器（Plan 编排引擎的"生成"环节）。
  把作者的复杂指令拆成**可串行执行**的最小步骤（research/write/edit/analyze），
  正文主线单线程、不并行（设计红线 1）。用 response_format 结构化输出，失败安全降级为 []。
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from app.context_engine.turn_scope import register_current_provider_payload
from app.utils.logger import get_logger

logger = get_logger(__name__)

_VALID_ACTIONS = {"research", "write", "edit", "analyze"}


def _extract_json_obj(text: str) -> Optional[Dict[str, Any]]:
    """从可能含代码块/前后文的 LLM 文本中稳健抽取首个 JSON 对象。"""
    s = str(text or "").strip()
    if not s:
        return None
    if "```" in s:
        try:
            start = s.find("```")
            newline = s.find("\n", start)
            end = s.find("```", newline + 1)
            if newline != -1 and end != -1:
                s = s[newline + 1 : end].strip()
        except (AttributeError, TypeError):
            pass
    left, right = s.find("{"), s.rfind("}")
    if left != -1 and right != -1 and right > left:
        s = s[left : right + 1]
    try:
        data = json.loads(s)
        return data if isinstance(data, dict) else None
    except (json.JSONDecodeError, TypeError):
        return None


async def generate_plan(
    gateway, provider: str, goal: str, context_hint: str = "", chapters: Optional[List[str]] = None
) -> List[Dict[str, Any]]:
    """把复杂写作指令拆成串行 todo 步骤。

    Args:
        chapters: 项目已存在章节 ID 列表（grounding：约束 edit/analyze 只能用已存在章节，
            禁止凭空捏造；新章 write 留空 chapter）。

    Returns:
        steps 列表 [{id, action, description, chapter, title, status="pending"}]；
        指令为空 / LLM 失败 / 解析失败时返回 []（安全降级，调用方决定是否回退到普通 write/edit）。
    """
    goal = str(goal or "").strip()
    if not goal:
        return []

    existing = [str(c).strip() for c in (chapters or []) if str(c).strip()]
    chapters_line = (
        "项目已存在章节（edit/analyze 的 chapter 必须从中选，勿捏造；write 新章留空）：" + ", ".join(existing[:60])
        if existing
        else "（项目暂无已存在章节；勿凭空编造章节 ID，新章 chapter 一律留空）"
    )

    system = (
        "你是小说写作任务规划器。把作者的复杂指令拆成**可串行执行**的最小步骤"
        "（正文主线单线程、不并行）。每步动作是 research(查证设定/伏笔)、write(写某章)、"
        "edit(改某章)、analyze(定稿分析) 之一，按执行顺序排列。"
        "同一章节最多一个写作步骤：不要把同一章拆成多个 write/edit 步骤，"
        "该章的全部要求写进这一步的 description。"
        "每步必须给一个 ≤12 字的简短 title 作为任务列表标题，细节写进 description。"
        "write/edit/analyze 每步只能对应**一个**已存在章节，禁止产出跨多章的步骤；"
        "analyze 只在作者明确要求定稿分析时才使用，不要自行追加收尾分析步骤。"
    )
    user = (
        f"指令：{goal}\n"
        f"上下文：{context_hint or '（无）'}\n"
        f"{chapters_line}\n"
        '只输出 JSON：{"steps":[{"action":"research|write|edit|analyze","description":"该步具体做什么",'
        '"chapter":"章节ID（edit/analyze 必须用已存在章节；write 新章留空）",'
        '"title":"该步的简短标题，≤12字，用作任务列表的一行（如「优化第一章感官描写」）"}]}，不要其它文字。'
    )
    try:
        messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        register_current_provider_payload(messages, owner="planner.generate_plan")
        resp = await gateway.chat(
            messages,
            provider=provider,
            temperature=0.2,
            response_format={"type": "json_object"},
        )
    except Exception as exc:
        logger.warning("generate_plan LLM call failed: %s", exc)
        return []

    data = _extract_json_obj(resp.get("content") or "")
    if not isinstance(data, dict):
        return []
    raw_steps = data.get("steps")
    if not isinstance(raw_steps, list):
        return []

    steps: List[Dict[str, Any]] = []
    for item in raw_steps:
        if not isinstance(item, dict):
            continue
        action = str(item.get("action") or "").strip().lower()
        if action not in _VALID_ACTIONS:
            continue
        description = str(item.get("description") or "").strip()
        if not description:
            continue
        steps.append(
            {
                "id": len(steps) + 1,
                "action": action,
                "description": description,
                "chapter": str(item.get("chapter") or "").strip(),
                "title": str(item.get("title") or "").strip(),
                "status": "pending",
            }
        )
    return _merge_same_chapter_steps(_drop_untargeted_steps(_fill_missing_chapters(steps, existing)))


def _drop_untargeted_steps(steps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """丢弃没有可执行目标的 edit/analyze 步骤（`chapter` 为空且无法回填）。

    U9：模型常额外追加「分析这几章定稿」这类跨章步骤，`chapter` 必然为空——
    执行期会被 `run_plan_step` 判为 `*_step_missing_chapter` 而让整个计划中断在最后一步。
    这类步骤没有可执行目标，产出即注定失败，故在生成阶段就不放进计划。
    这不是静默吞掉：作者看到的计划里从来没有这一步。

    **`write` 不在此列**：新建章节时 chapter 本就应为空（见 system 提示「write 新章留空」），
    由 Writer 在该步内调用 `create_chapter` 定目标。research 同样无需 chapter。
    """

    kept = [
        step
        for step in steps
        if step.get("action") not in {"edit", "analyze"} or str(step.get("chapter") or "").strip()
    ]
    for index, step in enumerate(kept, start=1):
        step["id"] = index
    return kept


def _fill_missing_chapters(steps: List[Dict[str, Any]], chapters: List[str]) -> List[Dict[str, Any]]:
    """description 点名了章节但 `chapter` 字段留空时，按序号回填既有章节 ID。

    U9：写作步骤缺 chapter 会被 `run_plan_step` 判为 `*_step_missing_chapter` 而失败。
    模型常把「第一章」只写进 description，此处做确定性兜底，避免整轮计划白跑。

    只在**唯一匹配**时回填：某序号在既有章节中恰好对应一个 ID 才填，0 个或多个（跨卷同号）
    一律留空，交由上游显式失败——宁可报错也不写错章。
    """

    from app.agents.intent import detect_target_chapter_numbers
    from app.utils.chapter_id import parse_chapter_number

    by_number: Dict[int, List[str]] = {}
    for chapter in chapters:
        number = parse_chapter_number(chapter)
        if number is not None:
            by_number.setdefault(int(number), []).append(chapter)

    for step in steps:
        if step.get("action") not in {"write", "edit", "analyze"} or str(step.get("chapter") or "").strip():
            continue
        numbers = detect_target_chapter_numbers(str(step.get("description") or ""))
        if len(numbers) != 1:
            continue
        candidates = by_number.get(numbers[0]) or []
        if len(candidates) == 1:
            step["chapter"] = candidates[0]
    return steps


def _merge_same_chapter_steps(steps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """把同一章节的多个写作步骤合并为一步（描述拼接），并重排 id。

    U9：plan 步骤只产出提案、不落盘（见 PlanExecutionService._run_writing_step），
    因此同一章的第二个写作步骤会基于磁盘上的旧正文重新起算，把前一步的提案覆盖掉。
    确定性合并即可规避，无需引入 plan 内 overlay（KISS：不为假想需求造复杂度）。
    research/analyze 步骤不参与合并。
    """

    merged: List[Dict[str, Any]] = []
    position_by_chapter: Dict[str, int] = {}
    for step in steps:
        chapter = str(step.get("chapter") or "").strip()
        if step.get("action") not in {"write", "edit"} or not chapter:
            merged.append(step)
            continue
        position = position_by_chapter.get(chapter)
        if position is None:
            position_by_chapter[chapter] = len(merged)
            merged.append(step)
            continue
        target = merged[position]
        extra = str(step.get("description") or "").strip()
        if extra and extra not in str(target.get("description") or ""):
            target["description"] = f"{target.get('description') or ''}；{extra}".strip("；")
        if not str(target.get("title") or "").strip():
            target["title"] = str(step.get("title") or "")
    for index, step in enumerate(merged, start=1):
        step["id"] = index
    return merged
