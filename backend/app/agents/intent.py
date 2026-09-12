# -*- coding: utf-8 -*-
"""
文枢 WenShape - 深度上下文感知的智能体小说创作系统
WenShape - Deep Context-Aware Agent-Based Novel Writing System

Copyright © 2025-2026 WenShape Team
License: PolyForm Noncommercial License 1.0.0

模块说明 / Module Description:
  写作意图判定器（Phase 5）—— "vibe writing" 的后端骨干。
  给定用户在 chat 里的一句话 + 上下文信号（是否选中正文、是否已有草稿），
  判定本轮意图：write（另写新内容）/ edit（修改已有草稿）。让前端只需一个输入框，
  由 AI/规则自行判定撰写 vs 编辑（对标 AI coding），而非手动模式开关。

  策略：确定性快路径优先（选中→编辑、无草稿→撰写，零成本零延迟）；仅"已有草稿且无选中"
  这种真正含糊的情形才（可选）调用 LLM 结构化判定，失败安全降级。
  Intent classifier for vibe writing: heuristic fast-paths first, optional LLM
  structured classification only for the genuinely ambiguous case, with safe fallback.
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, Optional

from app.context_engine.turn_scope import register_current_provider_payload
from app.utils.logger import get_logger

logger = get_logger(__name__)

_VALID_ACTIONS = {"write", "edit"}
_VALID_SCOPES = {"document", "selection"}
_VALID_SCALES = {"expand", "condense", "polish", "rewrite"}

_SCALE_HINTS = {
    "expand": ("大幅扩写", "大幅扩展", "深度扩写", "详细扩写", "丰富细节", "增加细节", "扩充篇幅", "写得更长"),
    "condense": ("精简", "压缩", "缩写", "删减", "缩短", "更简洁", "去掉冗余"),
    "rewrite": ("重写", "改写整章", "推倒重写", "重新写", "整体改写"),
    "polish": ("润色", "优化文笔", "改善表达", "调整措辞", "校对", "修辞"),
}


def detect_writing_scale(message: str) -> Optional[str]:
    """确定性识别作者要求的编辑幅度；未命中时保持 None，不猜测。"""

    text = str(message or "").strip().lower()
    for scale in ("expand", "condense", "rewrite", "polish"):
        if any(hint in text for hint in _SCALE_HINTS[scale]):
            return scale
    return None

# Phase 11：plan 意图启发式——明显的多步/多章复杂指令 → 走 Plan 编排引擎（串行，红线 1）。
_PLAN_HINTS = ("逐章", "逐节", "依次写", "分别写", "先写", "再写", "规划一下", "计划安排", "几章", "多章一起")
_OUTLINE_EDIT_HINTS = ("规划", "修改", "更新", "完善", "补充", "续写", "扩写", "调整", "添加", "写入")

# U9：多目标章节识别。旧实现只认 ASCII 数字 + 范围连接符（`3-4章`），
# 「第一,二章」「第三章和第四章」这类最自然的说法全漏 → plan 路由对多章指令基本不可达，
# 多目标退化为单轮 agentic，隐式写工具落到陈旧活动章节（U9 Context 的错章根因）。
#
# 只解析「章节序号」，**不合成章节 ID**：跨卷项目里「第九章」未必是 V1C9；
# 目标 ID 仍由 planner 依据既有章节列表判定（generate_plan 已收到 chapters）。
_CN_DIGIT_MAP = {"零": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
# 「两/俩/几/数/多」是数量词而非序数（汉语无「第两章」）；不纳入字符类即自然排除「后面两章」。
_CHAPTER_REF_RE = re.compile(r"([0-9一二三四五六七八九十零第,，、和与及\-—~～到至\s]{1,20})章")
_RANGE_SPLIT_RE = re.compile(r"[\-—~～到至]")
_ENUM_SPLIT_RE = re.compile(r"[,，、和与及\s]+")


def _cn_to_int(token: str) -> Optional[int]:
    """把阿拉伯数字或 1-99 的中文数字转成 int；无法解析返回 None。"""

    text = str(token or "").strip()
    if not text:
        return None
    if text.isdigit():
        value = int(text)
        return value if 1 <= value <= 999 else None
    if "十" in text:
        left, _, right = text.partition("十")
        tens = _CN_DIGIT_MAP.get(left, 1) if left else 1
        ones = _CN_DIGIT_MAP.get(right, 0) if right else 0
        value = tens * 10 + ones
        return value if 1 <= value <= 99 else None
    value = _CN_DIGIT_MAP.get(text)
    return value if value else None


def detect_target_chapter_numbers(message: str) -> list[int]:
    """抽取指令中显式点名的章节序号（去重保序）。

    仅用于判断「本轮是否多目标」，不产出章节 ID。支持中文数字、逗号/顿号/「和」枚举
    与范围式：``第一,二章`` → ``[1, 2]``；``第8到10章`` → ``[8, 9, 10]``。
    """

    found: list[int] = []
    for raw in _CHAPTER_REF_RE.findall(str(message or "")):
        run = raw.replace("第", "")
        if not any(char.isdigit() or char in _CN_DIGIT_MAP or char == "十" for char in run):
            continue
        for part in _ENUM_SPLIT_RE.split(run):
            bounds = [item for item in (piece.strip() for piece in _RANGE_SPLIT_RE.split(part)) if item]
            if len(bounds) == 2:
                start, end = _cn_to_int(bounds[0]), _cn_to_int(bounds[1])
                # 上界防御：避免「1-999章」把整轮撑成巨型 plan。
                if start and end and start <= end and end - start < 50:
                    found.extend(range(start, end + 1))
                continue
            value = _cn_to_int(part.strip())
            if value:
                found.append(value)
    ordered: list[int] = []
    for value in found:
        if value not in ordered:
            ordered.append(value)
    return ordered


def _requests_outline_edit(message: str) -> bool:
    """大纲是 Writer 可编辑资产；修改大纲不等于执行多章写作计划。"""

    text = str(message or "")
    return "大纲" in text and any(hint in text for hint in _OUTLINE_EDIT_HINTS)


def _detect_plan(message: str) -> bool:
    """明显的多步/多章复杂指令 → plan（保守：≥2 个显式章节目标，或明确多步关键词）。"""
    m = str(message or "")
    if len(detect_target_chapter_numbers(m)) >= 2:
        return True
    return any(hint in m for hint in _PLAN_HINTS)


# Phase 12：continue 意图——在已有草稿后续写（接着写），路由到编辑能力的 append 处理。
_CONTINUE_HINTS = ("续写", "接着写", "继续写", "往后写", "接下去", "往下写", "补完")


def _detect_continue(message: str) -> bool:
    m = str(message or "")
    return any(hint in m for hint in _CONTINUE_HINTS)


def _extract_json(text: str) -> Optional[Dict[str, Any]]:
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


def _heuristic(has_selection: bool, has_draft: bool) -> Optional[Dict[str, Any]]:
    """确定性快路径；返回 None 表示含糊、需进一步判定。"""
    if has_selection:
        return {"action": "edit", "scope": "selection", "reason": "已选中正文片段", "via": "heuristic"}
    if not has_draft:
        return {"action": "write", "scope": None, "reason": "本章尚无草稿", "via": "heuristic"}
    return None


async def _llm_classify(gateway, provider: str, message: str) -> Optional[Dict[str, Any]]:
    """对含糊情形用 LLM 结构化判定（write vs edit）。任何异常由调用方兜底。"""
    system = (
        "你是写作助手的意图判定器。判断用户这句话是想：\n"
        "- write：另写一段全新内容（如新场景、续写下一段剧情）\n"
        "- edit：修改/润色已有草稿（如调整措辞、改情节、压缩）\n"
        '只输出 JSON：{"action":"write|edit","scope":"document","reason":"≤20字理由"}，不要其它文字。'
    )
    user = f"用户输入：{str(message or '').strip()}\n本章已有草稿。请判定 action。"
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    register_current_provider_payload(messages, owner="intent.classify")
    resp = await gateway.chat(
        messages,
        provider=provider,
        temperature=0.0,
        response_format={"type": "json_object"},
    )
    data = _extract_json(resp.get("content") or "")
    if not data:
        return None
    action = str(data.get("action") or "").strip().lower()
    if action not in _VALID_ACTIONS:
        return None
    scope = str(data.get("scope") or "").strip().lower()
    if scope not in _VALID_SCOPES:
        scope = "document"
    return {"action": action, "scope": scope, "reason": str(data.get("reason") or "")[:40], "via": "llm"}


async def classify_writing_intent(
    message: str,
    *,
    has_selection: bool = False,
    has_draft: bool = False,
    gateway=None,
    provider: Optional[str] = None,
) -> Dict[str, Any]:
    """判定写作意图，返回 ``{action, scope, reason, via}``。

    - action: "write"（另写新内容） | "edit"（修改已有草稿）
    - scope: "selection" | "document" | None
    - via: "heuristic" | "llm"（来源，便于可观测）

    决策树：选中正文 → edit/selection；无草稿 → write；已有草稿且无选中 → LLM 判定，
    失败/无网关则安全降级为 edit/document（已有草稿时默认按修改处理最稳）。
    """
    scale = detect_writing_scale(message)
    if not has_selection and not _requests_outline_edit(message) and _detect_plan(message):
        return {"action": "plan", "scope": None, "scale": scale, "reason": "复杂多步/多章指令", "via": "heuristic"}

    if has_draft and not has_selection and _detect_continue(message):
        return {"action": "continue", "scope": "document", "scale": scale, "reason": "续写指令", "via": "heuristic"}

    fast = _heuristic(has_selection, has_draft)
    if fast is not None:
        fast["scale"] = scale
        return fast

    if gateway is not None and provider:
        try:
            decision = await _llm_classify(gateway, provider, message)
            if decision is not None:
                decision["scale"] = scale
                return decision
        except Exception as exc:
            logger.warning("Intent LLM classification failed; using heuristic fallback: %s", exc)

    return {
        "action": "edit",
        "scope": "document",
        "scale": scale,
        "reason": "已有草稿，默认按修改处理",
        "via": "heuristic",
    }
