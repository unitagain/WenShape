# -*- coding: utf-8 -*-
"""
文枢 WenShape - 深度上下文感知的智能体小说创作系统
WenShape - Deep Context-Aware Agent-Based Novel Writing System

Copyright © 2025-2026 WenShape Team
License: PolyForm Noncommercial License 1.0.0

模块说明 / Module Description:
  写作动作工具集（Phase B）—— 把反问、写正文、改正文与收尾统一为同一个 Writer 工具集，
  彻底对齐行业 AI coding 的文件编辑形态（Claude Code 的 Write / Edit）：
    - ask_clarification(questions) —— Writer 根据本轮上下文自主提出 1-3 个问题并暂停
    - write_content(content[, mode])  ≈ Write(file, content)   —— 覆盖 / 追加整章·整段
    - edit_lines(old_text, new_text)  ≈ Edit(old_string, new_string) —— 精确替换一处（唯一校验）
  关键范式：**agent（主循环里的 LLM）才是内容生成者**，工具只对"正文工作副本"做纯字符串操作、
  不内部调用 LLM。这样写/改是同一个功能的两种手段，由 agent 看着当前正文自主选择，
  完成后由调用方对「原文 vs 工作副本」求 diff 交付审阅采纳（与 writer/editor 的产物同质）。

  Writing-action toolset: keeps clarification, prose writing, editing, chapter targeting and turn
  completion in one agent-callable tool surface. The agent itself authors content and questions;
  tools only normalize the request or mutate a plain-text working copy (no nested LLM calls).
  A final diff(original vs working copy) is handed to the human for accept/reject.
"""

import hashlib
import json
from collections.abc import Mapping
from typing import Any, Dict, List, Optional

from app.agents.turn_effects import normalize_turn_effect
from app.error_contract import safe_error_code, tool_error_text
from app.utils.chapter_id import ChapterIDValidator, normalize_chapter_id
from app.utils.logger import get_logger

logger = get_logger(__name__)

_MAX_CLARIFICATION_QUESTIONS = 3
_MAX_CLARIFICATION_TEXT = 1000
_MAX_CLARIFICATION_REASON = 400
_MAX_CLARIFICATION_OPTIONS = 8

# ---------------------------------------------------------------- edit 匹配 --
# 模型复述原文时常有细微偏移（空白、全半角标点），精确匹配会失败，而失败会连锁消耗
# 迭代预算（见 plan.md §10.3 V2）。这里按「偏移代价」从小到大逐层放宽，
# **每层仍要求唯一命中**——不为了"匹配上"牺牲定位唯一性。
#
# Layered edit matching: models paraphrase whitespace and CJK/ASCII punctuation slightly.
# Each layer still demands a unique hit; ambiguity is always rejected, never guessed.

# 全角 → 半角标点。只收敛「同形异码」的标点，不动文字本身。
_PUNCT_FOLD = {
    "，": ",", "。": ".", "！": "!", "？": "?", "；": ";", "：": ":",
    "（": "(", "）": ")", "【": "[", "】": "]", "《": "<", "》": ">",
    "、": ",", "～": "~", "％": "%", "＃": "#", "＠": "@", "＆": "&",
    "＊": "*", "＋": "+", "－": "-", "／": "/", "＼": "\\", "＝": "=",
    "“": '"', "”": '"', "‘": "'", "’": "'", "－": "-", "—": "-", "–": "-",
}

_EDIT_LAYER_LABELS = {
    "exact": "精确匹配",
    "whitespace": "空白归一化",
    "punctuation": "标点归一化",
    "compact": "忽略空白",
}


class _EditMatch:
    """一次 edit 定位结果：原文中的精确 [start, end) 区间 + 命中层级 + 命中次数。"""

    __slots__ = ("start", "end", "layer", "count")

    def __init__(self, start: int, end: int, layer: str, count: int):
        self.start = start
        self.end = end
        self.layer = layer
        self.count = count


def _fold_punctuation(text: str) -> str:
    return "".join(_PUNCT_FOLD.get(ch, ch) for ch in text)


def _normalize_with_map(text: str, layer: str) -> tuple[str, List[int]]:
    """
    按层归一化，并返回「归一化位置 → 原文位置」的索引映射。

    Normalize per layer and return a map from normalized offsets back to original offsets.

    用索引映射而不是要求 1:1 等长，是因为最有价值的几层都会改变长度（空白折叠、去空白）。
    有了映射，归一化空间里的匹配结果仍能还原为原文的精确区间，替换不会破坏原文格式。
    """
    if layer == "exact":
        return text, list(range(len(text)))

    fold_punct = layer in ("punctuation", "compact")
    drop_space = layer == "compact"
    out: List[str] = []
    index_map: List[int] = []
    prev_space = False
    for position, ch in enumerate(text):
        if ch.isspace() or ch == "　":
            if drop_space:
                continue
            # 连续空白折叠为单个空格：吸收「多打/少打空格」这类常见的复述偏移。
            if prev_space:
                continue
            out.append(" ")
            index_map.append(position)
            prev_space = True
            continue
        prev_space = False
        out.append(_PUNCT_FOLD.get(ch, ch) if fold_punct else ch)
        index_map.append(position)
    return "".join(out), index_map


def _find_unique(haystack: str, needle: str, layer: str) -> Optional[_EditMatch]:
    """在归一化空间中定位，返回**原文**偏移；非唯一命中返回 count>1 的结果供调用方拒绝。"""
    if not needle:
        return None
    folded_hay, index_map = _normalize_with_map(haystack, layer)
    folded_needle, _ = _normalize_with_map(needle, layer)
    # 归一化后 needle 首尾可能残留折叠空格，会阻止与正文中段对齐；此处按层语义裁掉。
    if layer != "exact":
        folded_needle = folded_needle.strip()
    if not folded_needle:
        return None
    count = folded_hay.count(folded_needle)
    if count == 0:
        return None
    start = folded_hay.find(folded_needle)
    end = start + len(folded_needle)
    # 映射回原文：末位取「最后一个归一字符对应的原文位置 + 1」，避免吞掉尾字。
    original_start = index_map[start]
    original_end = index_map[end - 1] + 1
    return _EditMatch(original_start, original_end, layer, count)


def _locate_edit_span(haystack: str, needle: str) -> Optional[_EditMatch]:
    """
    逐层定位 old_text 在正文中的精确区间。

    Locate old_text within the prose, widening tolerance layer by layer.

    层序（代价递增）：精确 → 空白归一化 → 全半角标点归一化 → 去空白紧凑匹配。
    任一层唯一命中即返回；命中但不唯一则**立即返回**（不再放宽——更宽的层只会更模糊）。
    末层去掉全部空白：中文正文行内空白基本无语义，而模型复述时最常见的偏移正是
    「原文没有空格、复述里多打了空格」（如半角逗号后补空格），前几层的游程折叠救不了这种。
    """
    for layer in ("exact", "whitespace", "punctuation", "compact"):
        match = _find_unique(haystack, needle, layer)
        if match is not None:
            return match
    return None


def normalize_clarification_questions(value: Any) -> List[Dict[str, Any]]:
    """Normalize model-provided questions at the tool boundary.

    The Writer decides whether to ask and writes the question text. This
    helper only enforces the one-to-three item protocol and bounds optional
    fields; it never invents a question.
    """

    raw = value.get("questions") if isinstance(value, Mapping) else value
    if not isinstance(raw, (list, tuple)):
        return []
    normalized: List[Dict[str, Any]] = []
    seen_texts = set()
    for item in raw:
        if isinstance(item, Mapping):
            text = str(item.get("text") or item.get("question") or "").strip()
            item_type = str(item.get("type") or "").strip()
            reason = str(item.get("reason") or "").strip()
            options_value = item.get("options")
            default = str(item.get("default") or "").strip()
        else:
            text = str(item or "").strip()
            item_type = ""
            reason = ""
            options_value = None
            default = ""
        if not text:
            continue
        text = text[:_MAX_CLARIFICATION_TEXT]
        dedupe_key = text.casefold()
        if dedupe_key in seen_texts:
            continue
        seen_texts.add(dedupe_key)
        question: Dict[str, Any] = {"text": text}
        if item_type:
            question["type"] = item_type[:80]
        if reason:
            question["reason"] = reason[:_MAX_CLARIFICATION_REASON]
        if isinstance(options_value, (list, tuple)):
            options: List[str] = []
            for option in options_value:
                option_text = str(option or "").strip()
                if option_text and option_text not in options:
                    options.append(option_text[:200])
                if len(options) >= _MAX_CLARIFICATION_OPTIONS:
                    break
            if options:
                question["options"] = options
        if default:
            question["default"] = default[:200]
        normalized.append(question)
        if len(normalized) >= _MAX_CLARIFICATION_QUESTIONS:
            break
    return normalized


def writing_action_schemas(*, multi_asset: bool = False) -> List[Dict[str, Any]]:
    """返回写作动作与强制收尾工具定义。"""
    tools = [
        {
            "type": "function",
            "function": {
                "name": "ask_clarification",
                "description": (
                    "完成必要检索后，如果仍缺少会实质改变写作结果的作者决定，向作者提出具体问题。"
                    "问题数量由你按当前上下文自行决定，每次只能提出 1-3 个；调用后本轮立即暂停，"
                    "不得继续写正文、修改正文或调用 finish_turn。不要提出泛化问题，也不要重复已有上下文。"
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "questions": {
                            "type": "array",
                            "minItems": 1,
                            "maxItems": 3,
                            "description": "由你根据当前写作缺口选择的一个到三个问题",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "text": {"type": "string", "minLength": 1, "description": "给作者的问题原文"},
                                    "type": {"type": "string", "description": "可选的问题类型"},
                                    "reason": {"type": "string", "description": "可选：该问题为何影响本轮写作"},
                                    "options": {
                                        "type": "array",
                                        "items": {"type": "string"},
                                        "maxItems": 8,
                                        "description": "可选答案选项",
                                    },
                                    "default": {"type": "string", "description": "可选默认答案"},
                                },
                                "required": ["text"],
                                "additionalProperties": False,
                            },
                        }
                    },
                    "required": ["questions"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "create_chapter",
                "description": (
                    "为本轮写作建立一个新章节目标。用户要求新建章节、当前没有选中章节，或正文应写入新章时，"
                    "必须先调用此工具，再调用 write_content。完整写作并 finish_turn 成功后由系统自动保存章节。"
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "chapter_id": {
                            "type": "string",
                            "description": "新章节 ID，如 V1C4；留空则在当前卷自动选择下一个可用编号",
                        },
                        "title": {
                            "type": "string",
                            "description": "简洁章节标题；用户未指定时由你根据本章内容拟定",
                        },
                    },
                    "required": ["title"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "write_content",
                "description": (
                    "写入正文：覆盖或追加整章/整段。当需要从空白写新章、或大段重写时调用。"
                    "content 必须是你直接生成的小说正文本身（不要写解释、不要带标记）。"
                    "只能写入本轮活动章节；修改其它已有章节必须改用 write_chapter。"
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "chapter_id": {
                            "type": "string",
                            "description": "目标章节 ID，必须等于本轮活动章节（如 V1C4）；改其它章节请用 write_chapter",
                        },
                        "content": {
                            "type": "string",
                            "description": "要写入的完整正文（你生成的小说正文，纯文本，不含解释或 markdown 标记）",
                        },
                        "mode": {
                            "type": "string",
                            "enum": ["replace", "append"],
                            "description": "replace=覆盖全文（默认）；append=追加到现有正文末尾（续写）",
                        },
                    },
                    "required": ["chapter_id", "content"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "edit_lines",
                "description": (
                    "精确替换正文中的一处文本，用于局部修改/润色（改措辞、调情节、删冗余、扩写一段）。"
                    "old_text 必须与正文逐字一致且在正文中唯一出现；new_text 为替换后的文本（删除则留空字符串）。"
                    "若 old_text 不唯一，请提供更长、含上下文的片段以精确定位。"
                    "只能修改本轮活动章节；修改其它已有章节必须改用 edit_chapter。"
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "chapter_id": {
                            "type": "string",
                            "description": "目标章节 ID，必须等于本轮活动章节（如 V1C4）；改其它章节请用 edit_chapter",
                        },
                        "old_text": {
                            "type": "string",
                            "description": "要被替换的原文片段（必须与正文完全一致且唯一出现）",
                        },
                        "new_text": {
                            "type": "string",
                            "description": "替换后的新文本（删除该片段则传空字符串）",
                        },
                    },
                    "required": ["chapter_id", "old_text", "new_text"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "edit_chapter",
                "description": "编辑指定已有章节的一处文本。用于一次对话修改多个章节；chapter_id 必须是已存在章节，工具会先读取该章并生成独立 diff。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "chapter_id": {"type": "string", "description": "目标章节 ID，如 V1C001"},
                        "old_text": {"type": "string", "description": "目标章节中唯一的原文片段"},
                        "new_text": {"type": "string", "description": "替换后的文本"},
                    },
                    "required": ["chapter_id", "old_text", "new_text"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "write_chapter",
                "description": "整体重写或追加指定已有章节。一次 turn 可多次调用以修改多个章节，每章会形成独立 diff。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "chapter_id": {"type": "string", "description": "目标章节 ID"},
                        "content": {"type": "string", "description": "章节正文"},
                        "mode": {"type": "string", "enum": ["replace", "append"]},
                    },
                    "required": ["chapter_id", "content"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "finish_turn",
                "description": (
                    "结束本轮并提交收尾判断。无论本轮是交流、润色、写章还是修改剧情，都必须最后调用一次。"
                    "不要用自然语言代替此工具。事实候选必须引用最终正文中真实存在的 evidence 原句。"
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "change_type": {
                            "type": "string",
                            "enum": ["conversation", "prose_edit", "chapter_write", "plot_edit"],
                            "description": "conversation=交流；prose_edit=措辞润色；chapter_write=写新章/整体重写；plot_edit=剧情或设定发生变化",
                        },
                        "fact_operation": {
                            "type": "string",
                            "enum": ["none", "merge", "replace_chapter"],
                            "description": "none=不更新事实；merge=合并新增事实；replace_chapter=替换本章尚未确认的自动事实",
                        },
                        "chapter_summary": {
                            "type": "string",
                            "description": "写章或剧情修改后的简洁章节摘要；普通交流或纯润色可为空",
                        },
                        "fact_candidates": {
                            "type": "array",
                            "maxItems": 5,
                            "items": {
                                "type": "object",
                                "properties": {
                                    "statement": {"type": "string", "description": "以后需要遵守的故事事实"},
                                    "evidence": {"type": "string", "description": "最终正文中逐字存在的证据原句"},
                                    "category": {"type": "string", "description": "事件、关系、人物状态、物品、地点或世界规则"},
                                },
                                "required": ["statement", "evidence", "category"],
                            },
                        },
                        "message": {"type": "string", "description": "给用户的自然、简短完成说明"},
                    },
                    "required": ["change_type", "fact_operation", "chapter_summary", "fact_candidates", "message"],
                },
            },
        },
    ]
    if not multi_asset:
        tools = [item for item in tools if item.get("function", {}).get("name") not in {"edit_chapter", "write_chapter"}]
    return tools


class WritingActionToolset:
    """把"写正文/改正文"封装为 agent 可调用的写作工具，操作一份正文工作副本（纯字符串）。

    可选组合一个只读检索 toolset（retrieval_toolset，如 WriterToolset），让 agent 在同一主循环里
    "先检索设定、再写/改"——schemas() 会把检索工具与写作工具合并暴露，execute() 把未知工具名委托给它。

    Attributes:
        original_text: 流式/编辑前的原正文（diff 基线）。
        working_text: 当前工作副本（写/改累积结果）。
        actions: 写作动作记录（观测用，不参与逻辑）。
    """

    def __init__(
        self,
        original_text: str = "",
        *,
        retrieval_toolset: Any = None,
        active_chapter: str = "",
        existing_chapters: Optional[List[str]] = None,
        require_chapter_target: bool = False,
        multi_asset: bool = False,
        clarification_required: bool = False,
        writing_scale: str = "",
        target_word_count: int = 3000,
    ):
        self.original_text = str(original_text or "")
        self.working_text = self.original_text
        self.retrieval = retrieval_toolset
        self.actions: List[Dict[str, Any]] = []
        self._asset_buffers: Dict[str, Dict[str, Any]] = {}
        self._turn_effect_raw: Dict[str, Any] | None = None
        self._clarification: Dict[str, Any] | None = None
        self.active_chapter = normalize_chapter_id(active_chapter) if active_chapter else ""
        self.existing_chapters = {
            normalize_chapter_id(chapter)
            for chapter in (existing_chapters or [])
            if normalize_chapter_id(chapter)
        }
        self.target_chapter = self.active_chapter
        self.chapter_title = ""
        self.create_chapter_requested = False
        self.require_chapter_target = bool(require_chapter_target)
        self.multi_asset = bool(multi_asset)
        self.clarification_required = bool(clarification_required)
        self.writing_scale = str(writing_scale or "").strip().lower()
        self.target_word_count = max(1, int(target_word_count or 3000))
        self._output_contract_warned = False
        self.output_contract_degraded = False

    def _clarification_gate(self) -> str:
        if not self.clarification_required or self._clarification is not None:
            return ""
        return (
            "[tool_error code=clarification_required] 当前项目启用了积极确认。"
            "在本轮任何写作、修改或 finish_turn 之前，必须先调用 ask_clarification 提出 1-3 个具体作者选择；"
            "不得重试当前工具绕过反问。"
        )

    def _output_contract_error(self) -> str:
        """可核查的产出下限合同；warn-once-then-degrade（一次警告，仍不达标则放行并标记降级）。

        - expand：既有正文大幅扩写，下限取基线增幅与目标字数的最大值（既有行为）。
        - 新建章节整章撰写（create_chapter_requested）：装配层已把 target_word_count
          声明为「最低完成基线」，此处对齐执行——否则模型写数百字即 finish 也能通过
          （真实故障：反问恢复轮仅写 388 字交付）。用户显式要短章时，第二次 finish
          仍会放行并标记 degraded，不阻断。
        """
        baseline = len(self.original_text.strip())
        actual = len(self.working_text.strip())
        if self.writing_scale == "expand" and baseline:
            minimum = max(baseline + 300, int(baseline * 1.25), self.target_word_count)
            shortcoming = "作者要求大幅扩写"
        elif self.create_chapter_requested and not baseline:
            minimum = self.target_word_count
            shortcoming = "本章为整章撰写"
        else:
            return ""
        if actual >= minimum:
            return ""
        if self._output_contract_warned:
            self.output_contract_degraded = True
            return ""
        self._output_contract_warned = True
        return (
            f"[tool_error code=output_contract_unmet] {shortcoming}，但当前正文仅 {actual} 字；"
            f"本轮可核查下界为 {minimum} 字。请继续扩展场景、动作、感官、心理、环境与对白潜台词"
            "（可用 write_content mode=append 续写）后再 finish_turn。"
        )

    def schemas(self) -> List[Dict[str, Any]]:
        """写作工具（+ 可选检索工具）的合并 schema 列表。检索工具在前，便于 agent 先查后写。"""
        tools: List[Dict[str, Any]] = []
        if self.retrieval is not None:
            try:
                tools.extend(self.retrieval.schemas())
            except Exception as exc:  # 检索工具异常不应阻断写作能力
                logger.warning("retrieval toolset schemas() failed: %s", safe_error_code(exc), exc_info=True)
        tools.extend(writing_action_schemas(multi_asset=self.multi_asset))
        # 积极确认前置告警：模型选工具时看的是 schema 描述；反问要求若只存在于系统
        # 提示与被拦后的错误消息里，模型会先生成一整段正文再被拒——一次完整生成被
        # 作废（实测：先建章 → write_content 721 字被拦 → 才反问）。
        # create_chapter / ask_clarification 不受门控，不加注。
        if self.clarification_required and self._clarification is None:
            notice = (
                "注意：当前项目启用积极确认——本轮必须先调用 ask_clarification 提出问题并暂停等待作者回答，"
                "之后才能调用本工具；未反问前直接调用会被拒绝。"
            )
            for item in tools:
                function = item.get("function", {})
                if str(function.get("name") or "") in {
                    "write_content",
                    "edit_lines",
                    "edit_chapter",
                    "write_chapter",
                    "finish_turn",
                }:
                    function["description"] = f"{notice}{function.get('description') or ''}"
        return tools

    def is_result_recoverable(self, name: str) -> bool:
        if name in {"ask_clarification", "create_chapter", "write_content", "edit_lines", "edit_chapter", "write_chapter", "finish_turn"}:
            return False
        checker = getattr(self.retrieval, "is_result_recoverable", None)
        return bool(checker(name)) if callable(checker) else False

    @staticmethod
    def is_input_tool(name: str) -> bool:
        """Identify the tool whose request must dominate a provider batch."""

        return str(name or "") == "ask_clarification"

    async def execute(self, name: str, arguments: Any) -> str:
        """分发执行写作动作；未知名委托给检索工具。任何异常转为可读文本，避免中断 agentic 循环。"""
        args = self._parse_args(arguments)
        try:
            if name == "ask_clarification":
                return self._ask_clarification(args.get("questions"))
            if name == "create_chapter":
                return self._create_chapter(
                    str(args.get("chapter_id") or ""),
                    str(args.get("title") or ""),
                )
            if name == "write_content":
                gated = self._clarification_gate()
                if gated:
                    return gated
                return self._write_content(
                    str(args.get("content") or ""),
                    str(args.get("mode") or "replace"),
                    chapter_id=str(args.get("chapter_id") or ""),
                )
            if name == "edit_lines":
                gated = self._clarification_gate()
                if gated:
                    return gated
                return self._edit_lines(
                    str(args.get("old_text") or ""),
                    str(args.get("new_text") or ""),
                    chapter_id=str(args.get("chapter_id") or ""),
                )
            if name == "edit_chapter":
                gated = self._clarification_gate()
                if gated:
                    return gated
                return await self._edit_chapter(
                    str(args.get("chapter_id") or ""),
                    str(args.get("old_text") or ""),
                    str(args.get("new_text") or ""),
                )
            if name == "write_chapter":
                gated = self._clarification_gate()
                if gated:
                    return gated
                return await self._write_chapter(
                    str(args.get("chapter_id") or ""),
                    str(args.get("content") or ""),
                    str(args.get("mode") or "replace"),
                )
            if name == "finish_turn":
                if self._clarification is not None:
                    return "[tool_error code=clarification_pending] ask_clarification 已暂停本轮，不能提交 finish_turn"
                gated = self._clarification_gate()
                if gated:
                    return gated
                contract_error = self._output_contract_error()
                if contract_error:
                    return contract_error
                self._turn_effect_raw = dict(args)
                effect = self.terminal_payload()
                return f"本轮已收尾（change_type={effect['change_type']}, fact_operation={effect['fact_operation']}）。"
        except Exception as exc:
            logger.warning("Writing action %s failed: %s", name, safe_error_code(exc), exc_info=True)
            return tool_error_text(name, exc)

        if self.retrieval is not None:
            try:
                return await self.retrieval.execute(name, arguments)
            except Exception as exc:
                logger.warning("Retrieval tool %s failed: %s", name, safe_error_code(exc), exc_info=True)
                return tool_error_text(name, exc)
        return f"[未知工具：{name}]"

    def _ask_clarification(self, raw_questions: Any) -> str:
        """Record a Writer-authored input request and pause the current turn."""

        # 先行条件只看「正文是否已被实际写入/修改」；create_chapter 仅声明目标章节、
        # 不落任何正文，若也纳入封禁，积极确认模式会形成死锁（先建章 → write 被
        # clarification_required 门控 → ask 又因 create_chapter 被拒 → 写不进也问不了）。
        if self._turn_effect_raw is not None or any(
            action.get("action") in {"write", "edit"} for action in self.actions
        ):
            return "[tool_error code=clarification_must_precede_writing] ask_clarification 必须在写入或修改正文前调用"
        if self._clarification is not None:
            return "[tool_error code=clarification_already_requested] 本轮已经提出反问"
        questions = normalize_clarification_questions(raw_questions)
        if not questions:
            return "[tool_error code=clarification_questions_required] questions 至少包含一个有效问题"
        reason = next(
            (
                str(question.get("reason") or "").strip()
                for question in questions
                if str(question.get("reason") or "").strip()
            ),
            "writer_requested_clarification",
        )
        self._clarification = {
            "decision": "ask",
            "reason": reason[:_MAX_CLARIFICATION_REASON],
            "questions": questions,
            "question_count": len(questions),
        }
        self.actions.append({"action": "ask_clarification", "question_count": len(questions)})
        self._register_clarification_source(self._clarification)
        return f"已提出 {len(questions)} 个反问；本轮已暂停，等待作者回答。"

    @property
    def input_required(self) -> bool:
        return self._clarification is not None

    def input_required_payload(self) -> Optional[Dict[str, Any]]:
        if self._clarification is None:
            return None
        return dict(self._clarification)

    @staticmethod
    def _register_clarification_source(payload: Dict[str, Any]) -> None:
        try:
            from app.context_engine.turn_scope import current_turn_scope

            scope = current_turn_scope()
            if scope is None or not scope.source_closure_required:
                return
            identity = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            # Source ids are deterministic within a process while keeping the
            # question text out of trace labels and metric dimensions.
            digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:16]
            source_id = f"writer.clarification.{digest}"
            scope.register_source_content(
                source_id=source_id,
                asset_type="clarification_request",
                content=payload,
                selection_reason="writer_tool_ask_clarification",
                artifact_ref="WritingActionToolset.ask_clarification",
            )
        except Exception as exc:
            logger.warning("Clarification source registration failed: %s", safe_error_code(exc))

    def _create_chapter(self, chapter_id: str, title: str) -> str:
        if self._clarification is not None:
            return "[tool_error code=clarification_pending] ask_clarification 已暂停本轮，不能建立章节"
        if any(action.get("action") in {"write", "edit"} for action in self.actions):
            return "[create_chapter 必须在 write_content/edit_lines 之前调用]"
        clean_title = str(title or "").strip()
        if not clean_title:
            return "[create_chapter 需要非空 title]"
        default_volume = ChapterIDValidator.extract_volume_id(self.active_chapter) or self._default_volume()
        target = normalize_chapter_id(chapter_id, default_volume=default_volume) if chapter_id.strip() else ""
        if not target:
            target = self._suggest_next_chapter(default_volume)
        if not ChapterIDValidator.validate(target):
            return f"[create_chapter 的 chapter_id 无效：{chapter_id}]"
        if target in self.existing_chapters:
            return f"[章节 {target} 已存在，不能重复创建；如需修改请使用现有章节]"

        self.target_chapter = target
        self.chapter_title = clean_title[:120]
        self.create_chapter_requested = True
        self.original_text = ""
        self.working_text = ""
        self.actions.append(
            {
                "action": "create_chapter",
                "chapter": target,
                "title": self.chapter_title,
            }
        )
        return f"已建立新章节目标：{target}《{self.chapter_title}》。请继续调用 write_content 写入正文。"

    def _default_volume(self) -> str:
        volumes = [ChapterIDValidator.extract_volume_id(chapter) for chapter in self.existing_chapters]
        valid = sorted((volume for volume in volumes if volume), key=lambda value: int(value[1:]))
        return valid[-1] if valid else "V1"

    def _suggest_next_chapter(self, volume_id: str) -> str:
        max_number = 0
        for chapter in self.existing_chapters:
            parsed = ChapterIDValidator.parse(chapter)
            if not parsed or parsed["type"]:
                continue
            chapter_volume = f"V{parsed['volume'] or 1}"
            if chapter_volume == volume_id:
                max_number = max(max_number, int(parsed["chapter"]))
        return f"{volume_id}C{max_number + 1}"

    def _check_primary_chapter(self, chapter_id: str, alternative: str) -> str:
        """校验流式写作工具的目标必须是本轮活动章节；通过时返回空串。

        U9：`write_content`/`edit_lines` 的参数会作为 provisional 正文**流式推进前端编辑器**
        （`agentic.py` 的 `tool_call_delta` → `provisional_content`），编辑器展示的是活动章节，
        因此这两个工具只能作用于活动章节；跨章修改必须走非流式的 `write_chapter`/`edit_chapter`，
        否则会把甲章的文本流进乙章的编辑器。

        强制显式 `chapter_id` 的目的：把「静默写错章」变成模型可自纠的显式错误
        （历史故障：活动章节停在 V1C8 时要求改 V1C1/V1C2，隐式目标把改动落到了 V1C8）。
        `require_chapter_target=False` 的简化工具集没有章节语义，此时忽略该参数。
        """

        if not self.require_chapter_target:
            return ""
        requested = normalize_chapter_id(chapter_id) if str(chapter_id or "").strip() else ""
        if not requested:
            return (
                "[tool_error code=chapter_id_required] 请显式传入 chapter_id"
                f"（本轮活动章节：{self.target_chapter}）"
            )
        if requested != self.target_chapter:
            return (
                f"[tool_error code=chapter_target_mismatch] chapter_id={requested} 不是本轮活动章节"
                f"（{self.target_chapter}）；修改其它章节请改用 {alternative}。"
            )
        return ""

    def _write_content(self, content: str, mode: str, *, chapter_id: str = "") -> str:
        if self._clarification is not None:
            return "[tool_error code=clarification_pending] ask_clarification 已暂停本轮，不能写入正文"
        if self.require_chapter_target and not self.target_chapter:
            return "[当前没有目标章节；请先调用 create_chapter，再写入正文]"
        mismatch = self._check_primary_chapter(chapter_id, "write_chapter")
        if mismatch:
            return mismatch
        content = str(content or "")
        if not content.strip():
            return "[write_content 需要非空 content]"
        if mode == "append" and self.working_text.strip():
            self.working_text = self.working_text.rstrip() + "\n\n" + content
            verb = "追加"
        else:
            mode = "replace"
            self.working_text = content
            verb = "写入"
        self.actions.append({"action": "write", "mode": mode, "chars": len(content)})
        return f"已{verb} {len(content)} 字（mode={mode}）。当前正文共 {len(self.working_text)} 字。"

    def _edit_lines(self, old_text: str, new_text: str, *, chapter_id: str = "") -> str:
        if self._clarification is not None:
            return "[tool_error code=clarification_pending] ask_clarification 已暂停本轮，不能修改正文"
        if self.require_chapter_target and not self.target_chapter:
            return "[当前没有目标章节；请先选择章节，或调用 create_chapter 新建章节]"
        mismatch = self._check_primary_chapter(chapter_id, "edit_chapter")
        if mismatch:
            return mismatch
        old_text = str(old_text or "")
        new_text = str(new_text or "")
        if not old_text:
            return "[edit_lines 需要 old_text]"
        match = _locate_edit_span(self.working_text, old_text)
        if match is None or match.count != 1:
            try:
                from app.observability.usage_diagnostics import record_edit_miss

                record_edit_miss()
            except Exception as exc:
                logger.warning("Edit diagnostics failed: %s", type(exc).__name__)
        if match is None:
            return "未找到要替换的文本：old_text 未在当前正文中出现。请逐字核对原文，或改用 write_content 覆盖。"
        if match.count > 1:
            return (
                f"old_text 在正文中出现 {match.count} 次、不唯一，无法安全定位。"
                "请提供更长、包含上下文的唯一片段后重试。"
            )
        matched = self.working_text[match.start : match.end]
        self.working_text = self.working_text[: match.start] + new_text + self.working_text[match.end :]
        self.actions.append(
            {
                "action": "edit",
                "old_chars": len(matched),
                "new_chars": len(new_text),
                "match_layer": match.layer,
            }
        )
        delta = "删除" if not new_text else f"-{len(matched)} +{len(new_text)} 字"
        # 命中层级可观测：非精确层说明模型给的片段与原文有偏移，便于诊断偏移模式。
        hint = "" if match.layer == "exact" else f"（经 {_EDIT_LAYER_LABELS[match.layer]}定位）"
        return f"已替换 1 处{hint}（{delta}）。当前正文共 {len(self.working_text)} 字。"

    async def _load_asset(self, chapter: str) -> tuple[str, int]:
        target = normalize_chapter_id(chapter)
        if not target:
            return "", 0
        buffered = self._asset_buffers.get(target)
        if buffered is not None:
            return str(buffered.get("working") or ""), int(buffered.get("revision") or 0)
        if target == self.target_chapter:
            return self.working_text, 0
        loader = getattr(self.retrieval, "load_chapter_content", None)
        if not callable(loader):
            return "", 0
        content, revision = await loader(target)
        return str(content or ""), int(revision or 0)

    async def _edit_chapter(self, chapter: str, old_text: str, new_text: str) -> str:
        target = normalize_chapter_id(chapter)
        if not target:
            return "[edit_chapter 需要有效 chapter_id]"
        if target == self.target_chapter:
            return self._edit_lines(old_text, new_text, chapter_id=target)
        content, revision = await self._load_asset(target)
        if not content:
            return f"章节『{target}』暂无正文或不存在。"
        match = _locate_edit_span(content, old_text)
        if match is None:
            return f"章节『{target}』未找到 old_text。"
        if match.count != 1:
            return f"章节『{target}』中的 old_text 不唯一（{match.count} 处）。"
        revised = content[: match.start] + new_text + content[match.end :]
        prior = self._asset_buffers.get(target)
        original = str(prior.get("original") or "") if prior else content
        self._asset_buffers[target] = {"original": original, "working": revised, "revision": revision}
        self.actions.append({"action": "edit", "chapter": target, "old_chars": len(old_text), "new_chars": len(new_text)})
        return f"已修改章节 {target}，形成独立 diff；尚未写入磁盘。"

    async def _write_chapter(self, chapter: str, content: str, mode: str) -> str:
        target = normalize_chapter_id(chapter)
        if not target or not content.strip():
            return "[write_chapter 需要 chapter_id 和非空 content]"
        if target == self.target_chapter:
            return self._write_content(content, mode, chapter_id=target)
        original, revision = await self._load_asset(target)
        if not original and target not in self.existing_chapters:
            return f"章节『{target}』不存在；新章节请使用 create_chapter + write_content。"
        revised = original.rstrip() + "\n\n" + content if mode == "append" and original.strip() else content
        prior = self._asset_buffers.get(target)
        baseline = str(prior.get("original") or "") if prior else original
        self._asset_buffers[target] = {"original": baseline, "working": revised, "revision": revision}
        self.actions.append({"action": "write", "chapter": target, "mode": mode, "chars": len(content)})
        return f"已生成章节 {target} 的独立 diff（{len(revised)} 字），尚未写入磁盘。"

    @property
    def changed(self) -> bool:
        """工作副本是否相对原文发生变化（决定是否需要交付 diff）。"""
        return self.working_text != self.original_text or any(
            item.get("working") != item.get("original") for item in self._asset_buffers.values()
        )

    def change_proposals(self) -> List[Dict[str, Any]]:
        proposals = []
        for chapter, item in self._asset_buffers.items():
            if item.get("working") == item.get("original"):
                continue
            proposals.append(
                {
                    "asset_type": "chapter",
                    "asset_id": chapter,
                    "original": item.get("original", ""),
                    "revised": item.get("working", ""),
                    "base_revision": int(item.get("revision") or 0),
                }
            )
        return proposals

    @property
    def requires_terminal_tool(self) -> bool:
        return True

    def is_terminal_tool(self, name: str) -> bool:
        return str(name or "") == "finish_turn"

    @property
    def has_terminal_payload(self) -> bool:
        return self._turn_effect_raw is not None

    def terminal_payload(self) -> Dict[str, Any]:
        return normalize_turn_effect(
            self._turn_effect_raw,
            changed=self.changed,
            had_draft=bool(self.original_text.strip()),
        )

    def chapter_target(self) -> Optional[Dict[str, Any]]:
        if not self.create_chapter_requested or not self.target_chapter:
            return None
        return {
            "chapter": self.target_chapter,
            "title": self.chapter_title,
            "create": True,
        }

    @staticmethod
    def _parse_args(arguments: Any) -> Dict[str, Any]:
        if isinstance(arguments, dict):
            return arguments
        try:
            data = json.loads(arguments or "{}")
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}
