"""Materialize provider-facing context for writing routes."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from app.config import config
from app.context_engine.token_accounting import count_provider_payload, count_text_tokens
from app.context_engine.turn_scope import current_turn_scope


@dataclass(frozen=True)
class WriterRequest:
    messages: List[Dict[str, Any]]
    # None = 装配阶段不决定温度，由发起调用处按 provider profile 解析（见 assemble_writer_request）。
    # None means assembly does not decide temperature; the caller resolves it from the profile.
    temperature: Optional[float]
    max_tokens: int
    max_iterations: int
    fingerprint: str
    supply_report: "ContextSupplyReport"


@dataclass(frozen=True)
class ContextSupplyReport(Mapping[str, object]):
    available: tuple[str, ...]
    pushed: tuple[str, ...]
    retrieved: tuple[str, ...]
    used: tuple[str, ...]
    omitted: tuple[Dict[str, Any], ...]
    draft_tokens: int = 0
    draft_pushed_tokens: int = 0

    def __getitem__(self, key: str) -> object:
        return self.to_dict()[key]

    def __iter__(self) -> Iterator[str]:
        return iter(self.to_dict())

    def __len__(self) -> int:
        return 7

    def to_dict(self) -> Dict[str, Any]:
        return {
            "available": list(self.available),
            "pushed": list(self.pushed),
            "retrieved": list(self.retrieved),
            "used": list(self.used),
            "omitted": [dict(item) for item in self.omitted],
            "draft_tokens": self.draft_tokens,
            "draft_pushed_tokens": self.draft_pushed_tokens,
        }


class ContextAssemblyService:
    """Single owner for writer prompt assembly and generation budgets."""

    def __init__(self, *, language: str = "zh"):
        self.language = language

    def set_language(self, language: str) -> None:
        self.language = str(language or "zh")

    def assemble_writer_request(
        self,
        *,
        message: str,
        chapter: str,
        current_text: str,
        has_selection: bool,
        target_word_count: int,
        context_plan: Optional[Any] = None,
        existing_chapters: Optional[List[str]] = None,
        outline_push: str = "",
        relations_push: str = "",
        style_push: str = "",
        card_inventory_push: str = "",
        memory_inventory_push: str = "",
        writing_scale: str = "",
        outline_enabled: bool = True,
        clarification_policy: str = "",
        conversation_history: Optional[List[Dict[str, Any]]] = None,
        selection_text: str = "",
    ) -> WriterRequest:
        system = self.build_writer_system(
            has_draft=bool(str(current_text or "").strip()),
            has_chapter=bool(str(chapter or "").strip()),
            target_word_count=target_word_count,
            outline_enabled=outline_enabled,
            active_chapter=str(chapter or ""),
            writing_scale=writing_scale,
        )
        # require_consult 开启时把大纲推入 system 稳定前缀（缓存友好、高信号）：AI 须遵循整体规划。
        # 大纲是规划意图，不是已发生事实——不进 Canon/Summary。
        outline_text = str(outline_push or "").strip()
        if outline_text:
            system = (
                f"{system}\n\n【全文规划大纲（本作整体结构与走向，撰写本章须遵循，不得偏离主线）】\n{outline_text}"
            )
        # 卡片层作者设定的人物关系与称呼（U4）：规模有界且决定每句对白的称呼，
        # 因此与风格卡同属确定性必选项，默认推入稳定前缀，不依赖模型主动调用 query_relations。
        relations_text = str(relations_push or "").strip()
        if relations_text:
            system = (
                f"{system}\n\n【人物关系与称呼（作者设定，写对白必须据此称呼，不得自造昵称）】\n"
                f"读法：`A —[关系]→ B` 表示 A 是 B 的该关系；`B 称 A「X」` 表示 B 对 A 的称呼是 X；`A 称 B「Y」` 表示 A 对 B 的称呼是 Y。\n"
                f"涉及这些人物的对白、叙述或内心独白时，必须优先使用上述称呼；不得把姓名替换成自造昵称，也不得交换称呼方向。缺少称呼时才使用正文既有称呼或姓名。\n"
                f"{relations_text}"
            )
        style_text = str(style_push or "").strip()
        if style_text:
            system = (
                f"{system}\n\n【本项目文风设定（必须遵循）】\n{style_text}\n"
                "以上是作者明确设定的文风要求。生成或修改正文时必须落实到叙述视角、句式、节奏、用词、对白和描写密度；"
                "不得把文风设定复述进正文，也不得用默认文风覆盖它。"
            )
        inventory_text = str(card_inventory_push or "").strip()
        if inventory_text:
            system = (
                f"{system}\n\n【设定库目录（名称索引；正文按需查询）】\n{inventory_text}\n"
                "只要本轮涉及目录中的人物、地点、势力或物品，写作前必须先用 lookup_card 读取对应完整设定；"
                "目录只证明对象存在，不足以支持臆写其属性。"
            )
        memory_inventory_text = str(memory_inventory_push or "").strip()
        if memory_inventory_text:
            # 记忆目录与卡片目录（B1）同构：目录进稳定前缀、正文走 query_memory JIT。
            # 记忆是弱约束软知识（偏好/决定/约束/进度），不是 canon 事实——不参与事实对账。
            system = (
                f"{system}\n\n【创作记忆目录（既往偏好与决定索引）】\n{memory_inventory_text}\n"
                "以上是既往会话提炼的作者偏好、创作决定与约束。与本轮写作主题相关时，"
                "先用 query_memory 查询完整记忆内容再动笔；不得凭目录臆写记忆细节，也不得违反已激活的约束。"
            )
        policy_text = str(clarification_policy or "").strip()
        if policy_text:
            system = f"{system}\n\n【反问工具策略】\n{policy_text}"
        input_budget = int((getattr(context_plan, "budget", {}) or {}).get("input_tokens") or 0)
        draft_budget = min(12_000, max(3_000, int(input_budget * 0.60))) if input_budget else 6_000
        user, draft_projection = self._build_writer_user(
            message=message,
            chapter=chapter,
            current_text=current_text,
            has_selection=has_selection,
            target_word_count=target_word_count,
            draft_budget_tokens=draft_budget,
            existing_chapters=existing_chapters,
            selection_text=selection_text,
        )
        requested_max = max(4096, int(target_word_count * 2.0))
        if context_plan is not None:
            reserve = int((getattr(context_plan, "budget", {}) or {}).get("output_reserve_tokens") or 0)
            if reserve > 0:
                requested_max = min(requested_max, reserve)
        history_budget = min(8_000, max(2_000, int(input_budget * 0.25))) if input_budget else 4_000
        history_messages, history_report = self._project_conversation_history(
            conversation_history or [],
            current_message=message,
            budget_tokens=history_budget,
        )
        messages = [
            {"role": "system", "content": system},
            *history_messages,
            {"role": "user", "content": user},
        ]
        scope = current_turn_scope()
        if scope is not None and scope.source_closure_required:
            source_rows = [
                {
                    "source_id": "prompt.writer.system",
                    "asset_type": "prompt",
                    "content": system,
                    "selection_reason": "writer_system_prompt",
                    "artifact_ref": "ContextAssemblyService.build_writer_system",
                },
                {
                    "source_id": "input.user_message",
                    "asset_type": "user_message",
                    "content": str(message or ""),
                    "selection_reason": "author_instruction",
                    "artifact_ref": "session_chat:message",
                },
                {
                    "source_id": "config.writer_runtime",
                    "asset_type": "project_config",
                    "content": {
                        "agentic_max_iterations": int(config.get("retrieval", {}).get("agentic_max_iterations", 4)),
                        "language": self.language,
                        "target_word_count": int(target_word_count),
                    },
                    "selection_reason": "writer_runtime_configuration",
                    "artifact_ref": "config.yaml:retrieval",
                },
                {
                    "source_id": "project.volume_order",
                    "asset_type": "volume_order",
                    "content": list(existing_chapters or []),
                    "selection_reason": "chapter_target_resolution",
                    "artifact_ref": "draft_storage:list_chapters",
                },
                {
                    "source_id": "prompt.writer.user",
                    "asset_type": "prompt",
                    "content": user,
                    "selection_reason": "writer_user_prompt_projection",
                    "artifact_ref": "ContextAssemblyService.build_writer_user",
                },
            ]
            if chapter:
                source_rows.append(
                    {
                        "source_id": "target.chapter",
                        "asset_type": "chapter",
                        "content": str(chapter),
                        "selection_reason": "target_chapter",
                        "artifact_ref": "session_chat:chapter",
                    }
                )
            if current_text:
                source_rows.append(
                    {
                        "source_id": "draft.current",
                        "asset_type": "draft",
                        "content": current_text,
                        "selection_reason": "edit_baseline",
                        "artifact_ref": f"draft:{chapter}",
                    }
                )
            if relations_text:
                source_rows.append(
                    {
                        "source_id": "cards.relations",
                        "asset_type": "relations",
                        "content": relations_text,
                        "selection_reason": "authored_relation_edges_push",
                        "artifact_ref": "cards/relations.yaml",
                    }
                )
            if style_text:
                source_rows.append(
                    {
                        "source_id": "cards.style",
                        "asset_type": "style_card",
                        "content": style_text,
                        "selection_reason": "authored_style_card_push",
                        "artifact_ref": "cards/style.yaml",
                    }
                )
            if inventory_text:
                source_rows.append(
                    {
                        "source_id": "cards.inventory",
                        "asset_type": "card_inventory",
                        "content": inventory_text,
                        "selection_reason": "authored_card_inventory_push",
                        "artifact_ref": "cards/",
                    }
                )
            if memory_inventory_text:
                source_rows.append(
                    {
                        "source_id": "memory.inventory",
                        "asset_type": "memory_inventory",
                        "content": memory_inventory_text,
                        "selection_reason": "authored_memory_inventory_push",
                        "artifact_ref": "memory/MEMORY.md",
                    }
                )
            if history_messages:
                source_rows.append(
                    {
                        "source_id": "session.history",
                        "asset_type": "session_history",
                        "content": history_messages,
                        "selection_reason": "recent_author_decisions_for_writer_context",
                        "artifact_ref": "sessions/conversation.jsonl",
                    }
                )
            for row in source_rows:
                scope.register_source_content(**row)
            scope.register_provider_payload(
                messages,
                source_prefix="writer.initial",
                selection_reason="writer_initial_assembly",
                artifact_ref="ContextAssemblyService.assemble_writer_request",
            )
        # 单点构造：payload 参与 fingerprint 计算，WriterRequest 是实际下发值，
        # 两者若各写一份会随时间分叉，导致 assembly fingerprint 与真实请求不一致。
        # Build once: the payload feeds the fingerprint while WriterRequest is what actually
        # ships, so duplicating these fields would let the fingerprint drift from reality.
        #
        # temperature 不在此解析：本服务是纯装配（无 I/O、可确定性重放），
        # 而温度属于 provider profile，由持有 gateway 的 WritingService 在发起调用处解析
        # （见 §V1-4）。None 表示「装配阶段不决定温度」，不是「用默认 0.7」。
        temperature: Optional[float] = None
        max_iterations = int(config.get("retrieval", {}).get("agentic_max_iterations", 4)) + 2
        payload: Dict[str, Any] = {
            "messages": messages,
            "temperature": temperature,
            "max_tokens": requested_max,
            "max_iterations": max_iterations,
        }
        available = ["prompt", "user_message", "chapter", "project_config"]
        pushed = list(available)
        omitted: List[Dict[str, Any]] = []
        if conversation_history:
            available.append("session_history")
            if history_messages:
                pushed.append("session_history")
            if history_report["omitted_count"] or history_report["projected_count"]:
                omitted.append(
                    {
                        "type": "session_history",
                        "reason": "token_budget_projection",
                        "recoverable": True,
                        "source_ref": "sessions/conversation.jsonl",
                        **history_report,
                    }
                )
        if relations_text:
            # 关系边是卡片层设定：按 card 归桶上报，供给可观测（不与 canon 抽取关系混为一谈）。
            available.append("card")
            pushed.append("card")
        if style_text:
            available.append("style")
            pushed.append("style")
        if inventory_text:
            available.append("card_inventory")
            pushed.append("card_inventory")
        if memory_inventory_text:
            available.append("memory_inventory")
            pushed.append("memory_inventory")
        if current_text:
            available.append("draft")
            pushed.append("draft")
            if draft_projection["projected"]:
                omitted.append(
                    {
                        "type": "draft",
                        "reason": "token_budget_projection",
                        "recoverable": True,
                        "source_ref": f"draft:{chapter}",
                    }
                )
        for source_type in self._available_source_types(context_plan):
            if source_type not in available:
                available.append(source_type)
        supply_report = ContextSupplyReport(
            available=tuple(available),
            pushed=tuple(pushed),
            retrieved=(),
            used=tuple(pushed),
            omitted=tuple(omitted),
            draft_tokens=int(draft_projection["original_tokens"]),
            draft_pushed_tokens=int(draft_projection["pushed_tokens"]),
        )
        payload["supply_report"] = supply_report
        fingerprint_payload = {**payload, "supply_report": supply_report.to_dict()}
        fingerprint = hashlib.sha256(
            json.dumps(fingerprint_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        return WriterRequest(
            messages=messages,
            temperature=temperature,
            max_tokens=requested_max,
            max_iterations=max_iterations,
            fingerprint=fingerprint,
            supply_report=supply_report,
        )

    @classmethod
    def _project_conversation_history(
        cls,
        history: List[Dict[str, Any]],
        *,
        current_message: str,
        budget_tokens: int,
    ) -> tuple[List[Dict[str, str]], Dict[str, int]]:
        """Select model-facing history without trusting UI-only system messages."""

        normalized: List[Dict[str, str]] = []
        for item in history:
            role = str(item.get("role") or "").strip().lower()
            content = str(item.get("content") or "").strip()
            if not content:
                continue
            if role == "system" and str(item.get("type") or "") == "summary":
                normalized.append(
                    {
                        "role": "user",
                        "content": f"【此前对话摘要，仅作上下文参考】\n{content}",
                    }
                )
            elif role in {"user", "assistant"}:
                normalized.append({"role": role, "content": content})

        if (
            normalized
            and normalized[-1]["role"] == "user"
            and normalized[-1]["content"] == str(current_message or "").strip()
        ):
            normalized.pop()

        # 按完整 turn 选择（B3，F08）：user 消息与其后的 assistant 回复为一个不可分单元。
        # 旧实现按单条消息逆序装填，较长的 user 消息可被跳过而其 assistant 回复与更旧
        # 消息仍留下——产生「没有问题的孤立回答」并丢失该轮作者约束。
        turns: List[List[Dict[str, str]]] = []
        for item in normalized:
            if item["role"] == "user":
                turns.append([item])
            elif turns:
                turns[-1].append(item)
            else:
                # 历史以 assistant 开头（罕见）：归为独立单元，不与后续 user 混合。
                turns.append([item])

        selected: List[Dict[str, str]] = []
        projected_count = 0
        for turn in reversed(turns):
            projected_turn: List[Dict[str, str]] = []
            turn_projected = 0
            for item in turn:
                candidate = dict(item)
                per_message_budget = max(256, min(3_000, budget_tokens))
                projected_content, projected = cls._project_history_text(
                    candidate["content"],
                    budget_tokens=per_message_budget,
                )
                candidate["content"] = projected_content
                turn_projected += int(projected)
                projected_turn.append(candidate)
            proposed = [*projected_turn, *selected]
            if count_provider_payload(proposed).upper_bound_tokens <= budget_tokens:
                selected = proposed
                projected_count += turn_projected
                continue
            if not selected:
                # 预算极小：保留最近一个 turn 的压缩尾部（不再整 turn 丢弃）。
                # 该路径同样是一种投影（内容被进一步压缩），计入 projected_count。
                low, high = 1, max(1, sum(len(i["content"]) for i in projected_turn) // 2)
                best = ""
                marker = "\n…（较早对话内容按 token 预算省略）…\n"
                joined = "\n".join(i["content"] for i in projected_turn)
                prefix = joined.split(marker, 1)[0]
                while low <= high:
                    half = (low + high) // 2
                    trial = dict(projected_turn[0])
                    trial["content"] = prefix[:half] + marker
                    if count_provider_payload([trial]).upper_bound_tokens <= budget_tokens:
                        best = trial["content"]
                        low = half + 1
                    else:
                        high = half - 1
                if best:
                    candidate = dict(projected_turn[0])
                    candidate["content"] = best
                    selected = [candidate]
                    projected_count += max(turn_projected, 1)
                else:
                    marker_candidate = dict(projected_turn[0])
                    marker_candidate["content"] = marker
                    if count_provider_payload([marker_candidate]).upper_bound_tokens <= budget_tokens:
                        selected = [marker_candidate]
                        projected_count += max(turn_projected, 1)
            # 当前提下装不下的完整 turn：停止（不再尝试更旧 turn——
            # 逆序装填已保证留下的是最近的）。
            break

        return selected, {
            "selected_count": len(selected),
            "omitted_count": max(0, len(normalized) - len(selected)),
            "projected_count": projected_count,
        }

    @staticmethod
    def _project_history_text(text: str, *, budget_tokens: int) -> tuple[str, bool]:
        content = str(text or "")
        if count_text_tokens(content).upper_bound_tokens <= budget_tokens:
            return content, False
        marker = "\n…（较早对话内容按 token 预算省略）…\n"
        low, high = 1, max(1, len(content) // 2)
        best = marker
        while low <= high:
            half = (low + high) // 2
            candidate = content[:half] + marker + content[-half:]
            if count_text_tokens(candidate).upper_bound_tokens <= budget_tokens:
                best = candidate
                low = half + 1
            else:
                high = half - 1
        return best, True

    @staticmethod
    def _available_source_types(context_plan: Optional[Any]) -> List[str]:
        aliases = {
            "cards": "card",
            "character_card": "card",
            "world_card": "card",
            "style_card": "style",
            "summaries": "summary",
            "chapter_summary": "summary",
            "scene_brief": "summary",
            "relations": "canon",
            "fact": "canon",
            "text_chunk": "prose",
        }
        available: List[str] = []
        for row in tuple(getattr(context_plan, "snapshot", ()) or ()):
            item = dict(row)
            raw = str(item.get("asset_type") or item.get("type") or "").strip().lower()
            normalized = aliases.get(raw, raw)
            if normalized in {"style", "card", "canon", "memory", "summary", "draft", "prose"}:
                if normalized not in available:
                    available.append(normalized)
        return available

    def build_writer_system(
        self,
        *,
        has_draft: bool,
        has_chapter: bool = True,
        target_word_count: int = 3000,
        outline_enabled: bool = True,
        active_chapter: str = "",
        writing_scale: str = "",
    ) -> str:
        lang = "中文" if self.language == "zh" else "英文"
        active_label = str(active_chapter or "").strip()
        base = (
            "你是小说撰稿 agent，工作方式与 AI 编程助手一致：先理解已装配的本轮上下文，必要时用检索工具核对设定，再用写作工具落笔。"
            "『写新内容』与『改旧文』不是两件事，而是你的两个工具，由你看着当前正文自主选择：\n"
            "- create_chapter(chapter_id?, title): 为新章节建立规范化目标；完整写作并 finish_turn 成功后由系统可靠保存。\n"
            "- write_content(chapter_id, content[, mode]): 写入整章/整段正文（mode=replace 覆盖 / append 续写），"
            "content 是你直接创作的小说正文本身。\n"
            "- edit_lines(chapter_id, old_text, new_text): 精确替换正文中唯一出现的一处片段，用于局部修改/润色/删减"
            "（old_text 须与正文逐字一致且唯一）。\n"
            "- write_chapter(chapter_id, content[, mode]) / edit_chapter(chapter_id, old_text, new_text): "
            "改写**其它已有章节**（非本轮活动章节）；每章形成独立 diff，同一轮可对多个章节分别调用。\n"
            "- ask_clarification(questions): 在当前上下文已注入、必要检索完成后，若仍存在会实质影响结果的作者决策缺口，提出 1-3 个由你自行选择的问题；这是可选工具，每轮最多调用一次，调用后本轮暂停等待作者回答。\n"
            "检索工具（lookup_card/query_canon/query_relations/query_memory/read_chapter/search_prose）供你按需"
            "核对人物设定、关系、既往偏好与约束、伏笔与已确立事实，避免前后矛盾。\n\n"
        )
        if outline_enabled:
            base += (
                "大纲工具：read_outline 查阅全文规划；edit_outline 维护大纲"
                "（mode=edit 精确替换一处 / append 追加 / replace 整体重写），写入立即生效。"
                "只有作者要求调整规划时才调用 edit_outline，不要因为写完本章就顺手改写作者的大纲。\n\n"
            )
        base += (
            "工作原则：\n"
            "1) 先利用已注入上下文作判断，涉及设定库目录中的对象或关键事实时必须完成必要查证；"
            "当前工具预算足以支持多次有目的的 lookup/query/read。每次检索都应缩小明确缺口，避免重复同一查询或无目标空转，"
            "并在证据充分后及时调用 write_content/edit_lines 产出正文。\n"
            "2) 选对工具：用户要求新建章节或当前没有章节 → 先 create_chapter；正文为空或需大段新内容 → write_content；只改局部 → edit_lines。\n"
            "2b) 章节目标必须显式且准确：write_content/edit_lines 的 chapter_id 只能是本轮活动章节"
            + (f"（{active_label}）" if active_label else "")
            + "；要改其它章节一律用 write_chapter/edit_chapter 并各自传该章的 chapter_id。"
            "用户点名多个章节时，逐章分别调用对应工具，**绝不把某一章的改动写进活动章节**，也不要漏掉任何被点名的章节。\n"
            "3) 若上下文仍不足以确定关键走向，再由你决定是否调用 ask_clarification；问题必须具体、与本轮写作直接相关，不能泛问。调用后不得再调用写作工具或 finish_turn。\n"
            "4) content 只含小说正文，不夹带解释、标题或标记。\n"
            "5) 无论本轮是否修改正文，最后都必须调用 finish_turn，不能直接用自然语言结束。"
            "由你自行判断 change_type：普通交流=conversation；只改措辞/节奏=prose_edit；"
            "写新章或整体重写=chapter_write；改变事件、关系、人物状态或设定=plot_edit。\n"
            "6) 只有 chapter_write/plot_edit 才能提交章节摘要和事实候选。每条事实必须提供最终正文中逐字存在的 evidence；"
            "纯润色和普通交流必须 fact_operation=none。完成说明写入 finish_turn.message。\n"
            "7) 工具调用前的可见说明整轮最多一句，只在确有用户价值时说明当前目标。不要逐步复述“开始检索、开始写入、"
            "写作完成、提交收尾”等工具生命周期；这些动作由界面的工具轨迹展示。\n"
        )
        if not has_chapter:
            base += (
                "当前没有选中章节。普通交流可直接 finish_turn；若用户要求写作或新建章节，必须先调用 "
                "create_chapter 建立章节 ID 和标题，再调用 write_content，禁止在无目标章节时直接写正文。\n"
                + self._full_chapter_contract(target_word_count)
            )
        elif has_draft:
            scale = str(writing_scale or "").strip().lower()
            if scale == "expand":
                edit_contract = (
                    "作者要求『大幅扩写』：最终正文必须显著长于原文，并逐处把概述扩展为完整场景；"
                    "增加有因果作用的感官、动作、心理、环境、对白潜台词与转折，禁止只做等长替换或少量润色。"
                )
            elif scale == "condense":
                edit_contract = "作者要求压缩：删除重复与无效绕行，保留关键事件、因果、人物声音和必要氛围。"
            elif scale == "rewrite":
                edit_contract = "作者要求整体重写：可重组场景与表达，但必须保留指令未要求改变的既有事实与连续性。"
            else:
                edit_contract = "按作者点名的范围修改；未要求扩写或重写时，保持未涉及内容稳定。"
            base += (
                "本章已有正文（见用户消息）。这是『编辑』场景：优先用 edit_lines 做针对性的局部修改/润色"
                "；仅当用户明确要求重写整章时才 write_content(replace)。"
                f"{edit_contract}\n"
            )
        else:
            base += (
                "本章暂无正文。"
                + self._full_chapter_contract(target_word_count)
            )
        return f"{base}\n请用{lang}创作。"

    @staticmethod
    def _full_chapter_contract(target_word_count: int) -> str:
        """整章撰写的长度合同：两个入口（已选空章 / 模型自建新章）共用同一份要求。

        模型自行 create_chapter 的轮次（chapter 为空）此前只拿到「先建章再写」的弱指令，
        长度要求从未进入提示——真实故障：反问恢复轮仅写 388 字即收尾（目标 3000 字）。
        """
        return (
            "这是『撰写整章』场景：必须用 write_content **一次写出完整的一整章**，"
            f"目标约 {target_word_count} 字（这是最低完成基线，不是上限；若情节需要可自然写到 {int(target_word_count * 1.5)} 字），"
            "要有起承转合、场景与对白充分展开，写到本章自然收束——绝不能只写开头、提纲或片段就停。"
            "必须投入篇幅描写感官细节、人物动作与心理、环境氛围、对白潜台词和因果转折；避免概述、流水账、重复句式和仓促收尾。"
            "先在内部规划场景节拍，再一次性写出完整正文，直到冲突和情绪完成释放。\n"
        )

    @staticmethod
    def build_writer_user(
        *,
        message: str,
        chapter: str,
        current_text: str,
        has_selection: bool,
        target_word_count: int = 3000,
        existing_chapters: Optional[List[str]] = None,
    ) -> str:
        user, _projection = ContextAssemblyService._build_writer_user(
            message=message,
            chapter=chapter,
            current_text=current_text,
            has_selection=has_selection,
            target_word_count=target_word_count,
            draft_budget_tokens=6_000,
            existing_chapters=existing_chapters,
        )
        return user

    @staticmethod
    def _build_writer_user(
        *,
        message: str,
        chapter: str,
        current_text: str,
        has_selection: bool,
        target_word_count: int,
        draft_budget_tokens: int,
        existing_chapters: Optional[List[str]] = None,
        selection_text: str = "",
    ) -> tuple[str, Dict[str, Any]]:
        parts = [f"当前章节 ID：{chapter or '未选择'}"]
        chapters = [str(item) for item in (existing_chapters or []) if str(item).strip()]
        parts.append(f"现有章节：{', '.join(chapters) if chapters else '暂无'}")
        body = str(current_text or "")
        original_accounting = count_text_tokens(body)
        projected = False
        if body.strip():
            body, projected = ContextAssemblyService.project_draft_to_tokens(
                body,
                budget_tokens=max(1, int(draft_budget_tokens)),
            )
            parts.append(f"【当前正文】\n{body}")
            if projected:
                parts.append("【上下文完整性】当前正文因预算仅展示首尾；任何续写/修改前必须调用 read_chapter 获取真实最新正文，禁止依据省略段落臆写或覆盖旧内容。")
        else:
            parts.append("【当前正文】（空）")
        # 选区合同（C3，报告 §6.2）：选区原文进入受预算管理的 user 消息——
        # 只有 has_selection 布尔值无法唯一定位用户要改的文本范围。
        selection = str(selection_text or "").strip()
        if selection:
            # 选区摘要走固定子预算（draft 预算的一半上限），超长投影为提示。
            selection_budget = max(256, int(draft_budget_tokens) // 2)
            projected_selection, selection_projected = ContextAssemblyService.project_draft_to_tokens(
                selection,
                budget_tokens=selection_budget,
            )
            parts.append(f"【编辑器选区（用户当前选中的原文，修改须落在此范围）】\n{projected_selection}")
            if selection_projected:
                parts.append("（选区过长已按预算截断；完整原文以编辑器为准，修改前可用 read_chapter 范围读取核对。）")
        elif has_selection:
            parts.append("（用户在编辑器中有选中片段但未提供选区文本；请先用 read_chapter 核对当前正文，不要臆改。）")
        parts.append(f"\n用户指令：{str(message or '').strip()}")
        if not chapter:
            parts.append(
                "若本轮需要写作，先调用 create_chapter 建立新章节目标，再用 write_content 写出"
                f"**完整一整章**（目标约 {target_word_count} 字，写足写完，勿只开头）。"
            )
        elif not body.strip():
            parts.append(
                f"请先检索必要设定，再用 write_content 写出**完整一整章**（目标约 {target_word_count} 字，写足写完，勿只开头）。"
            )
        else:
            parts.append("请先检索必要设定，再用写作工具完成本轮。")
        return "\n".join(parts), {
            "projected": projected,
            "original_tokens": original_accounting.upper_bound_tokens,
            "pushed_tokens": count_text_tokens(body).upper_bound_tokens,
        }

    @staticmethod
    def project_draft_to_tokens(body: str, *, budget_tokens: int) -> tuple[str, bool]:
        text = str(body or "")
        if count_text_tokens(text).upper_bound_tokens <= budget_tokens:
            return text, False
        marker = "\n…（中段按 token 预算省略；完整正文可通过 read_chapter 恢复）…\n"
        low, high = 1, max(1, len(text) // 2)
        best = marker
        while low <= high:
            half = (low + high) // 2
            candidate = text[:half] + marker + text[-half:]
            if count_text_tokens(candidate).upper_bound_tokens <= budget_tokens:
                best = candidate
                low = half + 1
            else:
                high = half - 1
        return best, True
