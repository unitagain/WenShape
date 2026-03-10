# -*- coding: utf-8 -*-
"""
文枢 WenShape - 深度上下文感知的智能体小说创作系统
WenShape - Deep Context-Aware Agent-Based Novel Writing System

Copyright © 2025-2026 WenShape Team
License: PolyForm Noncommercial License 1.0.0

模块说明 / Module Description:
  编辑智能体 - 根据用户反馈修订草稿，支持补丁操作和选区编辑。
  Editor Agent responsible for revising drafts based on user feedback using patch operations.
"""

import re
from typing import Dict, Any, List, Optional
from app.agents.base import BaseAgent
from app.utils.text import normalize_newlines, normalize_for_compare
from app.prompts import (
    EDITOR_REJECTED_CONCEPTS_INSTRUCTION,
    get_editor_system_prompt,
    EDITOR_PATCH_END_ANCHOR,
    editor_append_only_prompt,
    editor_patch_ops_prompt,
    editor_selection_replace_prompt,
)
from app.utils.logger import get_logger
from app.utils.llm_output import parse_json_payload
from app.utils.version import increment_version

logger = get_logger(__name__)

class EditorAgent(BaseAgent):
    """
    编辑智能体 - 修订和完善草稿

    Agent responsible for revising drafts based on user feedback.
    Uses sophisticated patch operation techniques to apply precise changes
    while maintaining draft integrity and consistency.

    Features:
        - Patch-based operations (replace, delete, insert_before, insert_after)
        - Selection-based editing for targeted changes
        - Fallback to append-only mode for continuation scenarios
        - Automatic retry with better anchor extraction
    """

    def get_agent_name(self) -> str:
        """获取智能体标识 - 返回 'editor'"""
        return "editor"

    def get_system_prompt(self) -> str:
        """获取系统提示词 - 编辑专用"""
        return get_editor_system_prompt(language=self.language)

    async def execute(
        self,
        project_id: str,
        chapter: str,
        context: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        执行修订 - 根据用户反馈生成新版本

        Main entry point for draft revision. Loads existing draft,
        applies user feedback via LLM patch operations, and saves new version.

        Args:
            project_id: Project identifier.
            chapter: Chapter identifier.
            context: Dict with draft_version, user_feedback, rejected_entities, etc.

        Returns:
            Dict with success status, revised draft, new version, word count.
        """
        draft_version = context.get("draft_version", "v1")
        draft = await self.draft_storage.get_draft(project_id, chapter, draft_version)
        if not draft:
            return {
                "success": False,
                "error": f"Draft {draft_version} not found"
            }
        user_feedback = context.get("user_feedback", "")
        if not user_feedback:
            return {
                "success": False,
                "error": "User feedback is required"
            }
        style_card = await self.card_storage.get_style_card(project_id)
        rejected_entities = context.get("rejected_entities", [])
        memory_pack = context.get("memory_pack")
        revised_content = await self._generate_revision_from_feedback(
            original_draft=draft.content,
            user_feedback=user_feedback,
            style_card=style_card,
            rejected_entities=rejected_entities,
            memory_pack=memory_pack,
        )
        new_version = increment_version(draft_version)
        word_count = len(revised_content)
        revised_draft = await self.draft_storage.save_draft(
            project_id=project_id,
            chapter=chapter,
            version=new_version,
            content=revised_content,
            word_count=word_count,
            pending_confirmations=[]
        )
        return {
            "success": True,
            "draft": revised_draft,
            "version": new_version,
            "word_count": word_count
        }

    async def _generate_revision_from_feedback(
        self,
        original_draft: str,
        user_feedback: str,
        style_card: Any = None,
        rejected_entities: List[str] = None,
        memory_pack: Optional[Dict[str, Any]] = None,
        config_agent: str = None,
    ) -> str:
        """
        根据反馈生成修订稿 - 支持补丁和续写

        Generate revised draft from user feedback using patch operations.
        Auto-detects append intent and provides fallback strategies.

        Args:
            original_draft: Original draft text.
            user_feedback: User instructions for revision.
            style_card: Style card for consistent tone.
            rejected_entities: Entities to avoid/reject.
            memory_pack: Working memory context.
            config_agent: Override agent for configuration.

        Returns:
            Revised draft text.

        Raises:
            ValueError: If patch operations cannot be applied.
        """
        original_draft = normalize_newlines(original_draft or "")
        user_feedback = str(user_feedback or "").strip()

        def _has_append_intent(feedback: str) -> bool:
            """检测续写意图 - 查找续写关键字"""
            fb = str(feedback or "").strip()
            if not fb:
                return False
            keywords = (
                "续写",
                "继续写",
                "写下去",
                "补全",
                "补完",
                "扩写",
                "追加",
                "收尾",
                "结尾",
                "补充结尾",
                "完善结尾",
                "补写",
            )
            return any(key in fb for key in keywords)

        def _requires_change(feedback: str) -> bool:
            fb = str(feedback or "").strip()
            if not fb:
                return False
            negatives = ("不用改", "无需修改", "不需要修改", "不用修改", "不改", "别改", "保持不变")
            return not any(key in fb for key in negatives)

        def _extract_quoted_candidates(feedback: str) -> List[str]:
            """
            从用户指令中提取“被引用的原句/片段”，用于精确定位选区。
            支持中文引号/英文引号/书名号等常见写法。
            """
            fb = str(feedback or "")
            candidates: List[str] = []
            patterns = (
                r"“([^”]{2,240})”",
                r"\"([^\"]{2,240})\"",
                r"《([^》]{2,240})》",
                r"'([^']{2,240})'",
            )
            for pat in patterns:
                for m in re.finditer(pat, fb):
                    val = str(m.group(1) or "").strip()
                    if val and val not in candidates:
                        candidates.append(val)
            candidates.sort(key=len, reverse=True)
            return candidates

        def _extract_terms(feedback: str) -> List[str]:
            """
            提取“可能出现在正文中的”检索词，用于自动定位最相关段落。
            注意：这是兜底策略，不要求完美，只要能显著降低 no-op 概率即可。
            """
            fb = str(feedback or "")
            raw = re.findall(r"[\u4e00-\u9fff]{2,8}|[a-zA-Z0-9_]{3,}", fb)
            stop = {
                "修改",
                "润色",
                "优化",
                "调整",
                "提高",
                "加强",
                "删除",
                "添加",
                "扩写",
                "续写",
                "补全",
                "替换",
                "改成",
                "改为",
                "不要",
                "请",
                "帮我",
                "需要",
                "内容",
                "文字",
                "句子",
                "段落",
                "本章",
                "章节",
                "这里",
                "那里",
                "更加",
                "一点",
            }
            terms: List[str] = []
            for t in raw:
                t = str(t or "").strip()
                if not t or t in stop:
                    continue
                if t not in terms:
                    terms.append(t)
                if len(terms) >= 12:
                    break
            return terms

        def _iter_paragraph_spans(text: str) -> List[Dict[str, int]]:
            """
            按空行拆分段落并返回各段的 [start, end) 位置，保持偏移稳定。
            """
            spans: List[Dict[str, int]] = []
            start = 0
            n = len(text)
            while start < n:
                while start < n and text[start] in ("\n", "\r", " ", "\t"):
                    start += 1
                if start >= n:
                    break
                m = re.search(r"\n\s*\n", text[start:])
                if not m:
                    spans.append({"start": start, "end": n})
                    break
                end = start + m.start()
                spans.append({"start": start, "end": end})
                start = start + m.end()
            return spans

        def _score_span(text: str, start: int, end: int, terms: List[str]) -> float:
            seg = text[start:end]
            score = 0.0
            for term in terms:
                c = seg.count(term)
                if not c:
                    continue
                score += min(4, c) * (1.0 + min(5, len(term)) * 0.15)
            return score

        def _auto_locate_selection(text: str, feedback: str) -> Optional[Dict[str, Any]]:
            """
            自动定位“最可能需要被修改”的正文片段，用于补丁 ops 无效/无法定位时的兜底。
            返回：{start, end, selection_text}
            """
            if not text.strip():
                return None

            for candidate in _extract_quoted_candidates(feedback):
                pos = text.find(candidate)
                if pos >= 0:
                    return {"start": pos, "end": pos + len(candidate), "selection_text": candidate}

            spans = _iter_paragraph_spans(text)
            if not spans:
                return None

            fb = str(feedback or "")
            if any(key in fb for key in ("结尾", "最后", "末尾", "收尾")):
                span = spans[-1]
                sel = text[span["start"]:span["end"]]
                return {"start": span["start"], "end": span["end"], "selection_text": sel}
            if any(key in fb for key in ("开头", "开篇", "起始", "第一段")):
                span = spans[0]
                sel = text[span["start"]:span["end"]]
                return {"start": span["start"], "end": span["end"], "selection_text": sel}
            m = re.search(r"第\s*(\d{1,3})\s*段", fb)
            if m:
                idx = int(m.group(1)) - 1
                if 0 <= idx < len(spans):
                    span = spans[idx]
                    sel = text[span["start"]:span["end"]]
                    return {"start": span["start"], "end": span["end"], "selection_text": sel}

            terms = _extract_terms(feedback)
            if not terms:
                return None

            best = None
            best_score = 0.0
            for span in spans:
                s = _score_span(text, span["start"], span["end"], terms)
                if s > best_score:
                    best_score = s
                    best = span
            if not best or best_score <= 0:
                return None

            start = int(best["start"])
            end = int(best["end"])
            max_len = 1200
            min_len = 120
            if end - start > max_len:
                seg = text[start:end]
                anchor_pos = None
                for term in sorted(terms, key=len, reverse=True):
                    p = seg.find(term)
                    if p >= 0:
                        anchor_pos = start + p
                        break
                if anchor_pos is None:
                    anchor_pos = start
                win_start = max(start, anchor_pos - 260)
                win_end = min(end, anchor_pos + 940)
                if win_end - win_start < min_len:
                    win_end = min(end, win_start + min_len)
                start, end = win_start, win_end
            sel = text[start:end]
            return {"start": start, "end": end, "selection_text": sel}

        async def _selection_replace_with_context(
            original: str,
            start: int,
            end: int,
            selection_text: Optional[str],
            feedback: str,
            context_items: List[str],
            agent: Optional[str],
        ) -> str:
            """
            强约束选区替换：只改指定 [start, end) 范围，避免整稿重写。
            用于自动兜底和前端“选区编辑”保持一致性。
            """
            original_norm = normalize_newlines(original or "")
            start = max(0, min(int(start), len(original_norm)))
            end = max(0, min(int(end), len(original_norm)))
            if end < start:
                start, end = end, start
            if end <= start:
                raise ValueError("selection_replace_invalid_range")

            sel = original_norm[start:end]
            provided = normalize_newlines(selection_text or "").strip("\n")
            if provided and normalize_for_compare(provided) != normalize_for_compare(sel):
                raise ValueError("selection_replace_mismatch")

            prefix_hint = original_norm[max(0, start - 220):start]
            suffix_hint = original_norm[end:min(len(original_norm), end + 220)]
            prompt = editor_selection_replace_prompt(
                selection_text=sel,
                user_feedback=feedback,
                prefix_hint=prefix_hint,
                suffix_hint=suffix_hint,
                language=self.language,
            )
            messages = self.build_messages(
                system_prompt=prompt.system,
                user_prompt=prompt.user,
                context_items=context_items,
            )
            response = await self.call_llm(messages, config_agent=agent, return_meta=True)
            replacement = normalize_newlines(str(response.get("content") or "")).strip("\n")
            if not replacement.strip():
                raise ValueError("selection_replace_empty")
            revised = (original_norm[:start] + replacement + original_norm[end:]).rstrip()
            if normalize_for_compare(revised) != normalize_for_compare(original_norm):
                return revised

            retry_messages = list(messages)
            retry_messages.append({"role": "assistant", "content": str(response.get("content") or "")})
            retry_messages.append(
                {
                    "role": "user",
                    "content": "\n".join(
                        [
                            "你刚才输出的替换文本未产生任何可见修改。",
                            "请重新输出“替换后的选区文本”，并确保：",
                            "- 必须与选区原文不同",
                            "- 严格执行用户反馈",
                            "现在重新输出：",
                        ]
                    ),
                }
            )
            response2 = await self.call_llm(retry_messages, config_agent=agent, return_meta=True)
            replacement2 = normalize_newlines(str(response2.get("content") or "")).strip("\n")
            if not replacement2.strip():
                raise ValueError("selection_replace_empty_retry")
            revised2 = (original_norm[:start] + replacement2 + original_norm[end:]).rstrip()
            if normalize_for_compare(revised2) == normalize_for_compare(original_norm):
                raise ValueError("selection_replace_no_effect")
            return revised2

        def _has_strong_edit_intent(feedback: str) -> bool:
            """检测强编辑意图 - 查找修改关键字"""
            fb = str(feedback or "").strip()
            if not fb:
                return False
            keywords = (
                "删除",
                "删去",
                "删掉",
                "去掉",
                "移除",
                "改为",
                "改成",
                "调整为",
                "调整成",
                "替换",
                "修改",
                "精简",
                "缩短",
                "扩写",
                "补全",
                "补充",
                "续写",
                "完善",
                "润色",
            )
            return any(key in fb for key in keywords)
        context_items = []
        if style_card:
            try:
                context_items.append(f"Style: {style_card.style}")
            except (AttributeError, TypeError) as e:
                logger.warning("Failed to add style guidance: %s", e)
        if rejected_entities:
            context_items.append(
                "被拒绝概念：" + ", ".join(rejected_entities) + "\n" + EDITOR_REJECTED_CONCEPTS_INSTRUCTION
            )
        if memory_pack:
            context_items.extend(self._format_memory_pack_context(memory_pack))
        strong_intent = _has_strong_edit_intent(user_feedback) or _requires_change(user_feedback)
        excerpts = self._build_patch_excerpts(
            original_draft=original_draft,
            user_feedback=user_feedback,
            memory_pack=memory_pack,
        )
        prompt = editor_patch_ops_prompt(excerpts=excerpts, user_feedback=user_feedback, language=self.language)
        messages = self.build_messages(
            system_prompt=prompt.system,
            user_prompt=prompt.user,
            context_items=context_items
        )
        raw = ""
        try:
            response = await self.call_llm(messages, config_agent=config_agent, return_meta=True)
            raw = str(response.get("content") or "").strip()
            data, err = parse_json_payload(raw, expected_type=dict)
            if err or not isinstance(data, dict):
                logger.warning(f"[编辑] 首次补丁解析失败: err={err}, raw_preview={raw[:200] if raw else 'empty'}")
                raise ValueError(f"patch_ops_parse_failed: {err}")
            ops = data.get("ops")
            if not isinstance(ops, list):
                raise ValueError("patch_ops_invalid_schema: missing ops list")

            revised, _ = self._apply_patch_ops(original_draft, ops)
            changed = normalize_for_compare(revised) != normalize_for_compare(original_draft)
            if changed:
                return revised
            if strong_intent and not _has_append_intent(user_feedback):
                located = _auto_locate_selection(original_draft, user_feedback)
                if located:
                    revised3 = await _selection_replace_with_context(
                        original=original_draft,
                        start=int(located["start"]),
                        end=int(located["end"]),
                        selection_text=str(located.get("selection_text") or ""),
                        feedback=user_feedback,
                        context_items=context_items,
                        agent=config_agent,
                    )
                    if normalize_for_compare(revised3) != normalize_for_compare(original_draft):
                        return revised3
                raise ValueError("patch_ops_no_effect")
            if not _has_append_intent(user_feedback):
                return revised
            # ====================================================================
            # Fallback to append-only mode / 回退到续写模式
            # ====================================================================
            # When user explicitly requests continuation but patch ops have no
            # effect, switch to append-only generation strategy
            tail_excerpt = normalize_for_compare(original_draft)[-1800:]
            append_prompt = editor_append_only_prompt(tail_excerpt=tail_excerpt, user_feedback=user_feedback, language=self.language)
            append_messages = self.build_messages(
                system_prompt=append_prompt.system,
                user_prompt=append_prompt.user,
                context_items=context_items,
            )
            append_resp = await self.call_llm(append_messages, config_agent=config_agent, return_meta=True)
            append_text = str(append_resp.get("content") or "").strip()
            append_text = normalize_newlines(append_text).strip()
            if not append_text:
                return revised
            base = normalize_for_compare(original_draft)
            separator = "\n\n" if base and not base.endswith("\n") else "\n"
            return (base + separator + append_text).rstrip()
        except Exception as exc:
            # ====================================================================
            # Retry with better anchor extraction / 重试并改进锚点提取
            # ====================================================================
            # If patch application fails, retry with larger excerpt context
            # and stricter anchor matching requirements
            retry_excerpts = self._build_patch_excerpts(
                original_draft=original_draft,
                user_feedback=user_feedback,
                memory_pack=memory_pack,
                head_chars=1600,
                tail_chars=2600,
                window=240,
                max_excerpts=10,
            )
            retry_messages = list(messages)
            retry_messages.append({"role": "assistant", "content": raw})
            retry_messages.append(
                {
                    "role": "user",
                    "content": "\n".join(
                        [
                            "你刚才输出的补丁 ops 无法应用到原文。",
                            f"错误：{exc}",
                            "请重新输出 JSON（同 schema），并确保：",
                            "- replace/delete 的 before 必须是原文摘录中可逐字匹配的片段",
                            "- insert_* 的 anchor 必须是原文摘录中可逐字匹配的片段",
                            "- 尽量减少 ops 数量，只改必要位置",
                            "- 必须至少输出 1 条 op，且应用后必须产生可见改动",
                            "",
                            "原文摘录（请仅从这里复制粘贴 before/anchor）：",
                            "<<<EXCERPTS_START>>>",
                            retry_excerpts or "",
                            "<<<EXCERPTS_END>>>",
                            "现在重新输出：",
                        ]
                    ),
                }
            )
            response2 = await self.call_llm(retry_messages, config_agent=config_agent, return_meta=True)
            raw2 = str(response2.get("content") or "").strip()
            data2, err2 = parse_json_payload(raw2, expected_type=dict)
            if err2 or not isinstance(data2, dict):
                logger.error(f"[编辑] 重试补丁解析失败 (第二次): err={err2}, raw_preview={raw2[:200] if raw2 else 'empty'}")
                logger.error(f"[编辑] 原始响应预览: {raw[:200] if raw else 'empty'}")
                logger.error(f"[编辑] 重试响应预览: {raw2[:200] if raw2 else 'empty'}")
                raise ValueError(f"patch_ops_retry_parse_failed: {err2}") from exc
            ops2 = data2.get("ops")
            if not isinstance(ops2, list):
                raise ValueError("patch_ops_retry_invalid_schema: missing ops list") from exc
            revised2, _ = self._apply_patch_ops(original_draft, ops2)
            if normalize_for_compare(revised2) != normalize_for_compare(original_draft):
                return revised2
            if _requires_change(user_feedback) and not _has_append_intent(user_feedback):
                located = _auto_locate_selection(original_draft, user_feedback)
                if located:
                    try:
                        revised3 = await _selection_replace_with_context(
                            original=original_draft,
                            start=int(located["start"]),
                            end=int(located["end"]),
                            selection_text=str(located.get("selection_text") or ""),
                            feedback=user_feedback,
                            context_items=context_items,
                            agent=config_agent,
                        )
                        if normalize_for_compare(revised3) != normalize_for_compare(original_draft):
                            return revised3
                    except Exception as auto_exc:
                        logger.info("Auto-selection fallback failed: %s", auto_exc)
            if strong_intent and not _has_append_intent(user_feedback):
                raise ValueError(
                    "未能生成可应用的修改补丁：请在指令中直接引用（复制粘贴）要修改的原句或段落，或提供更具体的定位关键词。"
                ) from exc
            return revised2

    def _build_patch_excerpts(
        self,
        original_draft: str,
        user_feedback: str,
        memory_pack: Optional[Dict[str, Any]] = None,
        head_chars: int = 900,
        tail_chars: int = 1400,
        window: int = 180,
        max_excerpts: int = 8,
    ) -> str:
        """
        构建补丁操作的摘录上下文 - 避免超长上下文

        Build compact excerpts for patch generation. Extracts beginning, end,
        and semantically relevant sections around feedback keywords.

        Strategy:
        - Include head (beginning) and tail (end) of draft for orientation
        - Extract local context around feedback keywords (with window)
        - Merge overlapping ranges to avoid duplication
        - Return formatted text for LLM to copy-paste from

        Args:
            original_draft: Full draft text.
            user_feedback: User instructions (used to extract keywords).
            memory_pack: Memory context with character/world info.
            head_chars: Characters to include from start.
            tail_chars: Characters to include from end.
            window: Context window size around keywords.
            max_excerpts: Max local excerpts to extract.

        Returns:
            Formatted string with [开头摘录], [相关摘录], [结尾摘录] sections.
        """
        text = normalize_newlines(original_draft)
        if not text.strip():
            return ""
        head = text[:head_chars].strip()
        tail = text[-tail_chars:].strip() if len(text) > tail_chars else text.strip()
        terms: List[str] = []
        # Extract keywords from user feedback and memory for context matching
        for part in re.findall(r"[\u4e00-\u9fff]{2,8}|[a-zA-Z0-9_]{3,}", str(user_feedback or "")):
            part = part.strip()
            if part and part not in terms:
                terms.append(part)
            if len(terms) >= 10:
                break
        if isinstance(memory_pack, dict):
            digest = memory_pack.get("chapter_digest")
            if isinstance(digest, dict):
                for name in (digest.get("top_characters") or [])[:6]:
                    n = str(name or "").strip()
                    if n and n not in terms:
                        terms.append(n)
            snapshot = memory_pack.get("card_snapshot")
            if isinstance(snapshot, dict):
                for item in (snapshot.get("characters") or [])[:6]:
                    if isinstance(item, dict):
                        n = str(item.get("name") or "").strip()
                        if n and n not in terms:
                            terms.append(n)
        # ====================================================================
        # Find local context windows around keywords / 查找关键词周围的上下文
        # ====================================================================
        ranges: List[tuple[int, int]] = []
        for term in terms[:10]:
            start = 0
            hits = 0
            while hits < 2:
                pos = text.find(term, start)
                if pos < 0:
                    break
                left = max(0, pos - window)
                right = min(len(text), pos + len(term) + window)
                ranges.append((left, right))
                start = pos + len(term)
                hits += 1
        ranges.sort()
        # Merge overlapping ranges to avoid duplication
        merged: List[tuple[int, int]] = []
        for left, right in ranges:
            if not merged:
                merged.append((left, right))
                continue
            prev_left, prev_right = merged[-1]
            if left <= prev_right:
                merged[-1] = (prev_left, max(prev_right, right))
            else:
                merged.append((left, right))
        excerpt_blocks: List[str] = []
        if head:
            excerpt_blocks.append("【开头摘录】\n" + head)
        picked = 0
        for left, right in merged:
            if picked >= max_excerpts:
                break
            frag = text[left:right].strip()
            if not frag:
                continue
            excerpt_blocks.append("【相关摘录】\n" + frag)
            picked += 1
        if tail:
            excerpt_blocks.append("【结尾摘录】\n" + tail)
        return "\n\n".join(excerpt_blocks).strip()

    def _apply_patch_ops(self, original_draft: str, raw_ops: List[Any]) -> tuple[str, int]:
        """
        Apply patch ops to the full draft.
        安全策略：
        - 所有定位均基于 before/anchor 的精确子串匹配（默认第 1 次出现）
        - 先解析定位，按位置从后往前应用，避免索引漂移
        """
        text = normalize_newlines(original_draft)
        if not isinstance(raw_ops, list) or not raw_ops:
            return text.rstrip(), 0

        def find_nth(haystack: str, needle: str, occurrence: int) -> int:
            if not needle:
                return -1
            occurrence = max(int(occurrence or 1), 1)
            start = 0
            for _ in range(occurrence):
                pos = haystack.find(needle, start)
                if pos < 0:
                    return -1
                start = pos + len(needle)
            return pos
        resolved: List[Dict[str, Any]] = []
        for idx, item in enumerate(raw_ops[:12]):
            if not isinstance(item, dict):
                continue
            op = str(item.get("op") or "").strip()
            occurrence = item.get("occurrence") or 1
            if op in {"replace", "delete"}:
                before = str(item.get("before") or "")
                if not before.strip():
                    continue
                pos = find_nth(text, before, occurrence)
                if pos < 0:
                    raise ValueError(f"patch_op_failed: before_not_found op#{idx + 1}")
                resolved.append(
                    {
                        "op": op,
                        "start": pos,
                        "end": pos + len(before),
                        "after": "" if op == "delete" else str(item.get("after") or ""),
                    }
                )
                continue
            if op in {"insert_before", "insert_after"}:
                anchor = str(item.get("anchor") or "")
                content = str(item.get("content") or "")
                if not anchor.strip() or not content:
                    continue
                if anchor == EDITOR_PATCH_END_ANCHOR:
                    insert_at = len(text)
                else:
                    pos = find_nth(text, anchor, occurrence)
                    if pos < 0:
                        raise ValueError(f"patch_op_failed: anchor_not_found op#{idx + 1}")
                    insert_at = pos if op == "insert_before" else pos + len(anchor)
                resolved.append(
                    {
                        "op": op,
                        "start": insert_at,
                        "end": insert_at,
                        "after": content,
                    }
                )
                continue
        resolved.sort(key=lambda r: r["start"], reverse=True)
        for item in resolved:
            start = int(item["start"])
            end = int(item["end"])
            after = str(item.get("after") or "")
            text = text[:start] + after + text[end:]
        return text.rstrip(), len(resolved)

    async def suggest_revision(
        self,
        project_id: str,
        original_draft: str,
        user_feedback: str,
        rejected_entities: List[str] = None,
        memory_pack: Optional[Dict[str, Any]] = None,
    ) -> str:
        """

        Suggest a revision without persisting it.
        生成“修改建议”，不写入草稿版本（用于前端未保存内容的 Diff 预览）。
        """

        if original_draft is None:
            original_draft = ""
        if not user_feedback:
            raise ValueError("User feedback is required")
        style_card = await self.card_storage.get_style_card(project_id)
        return await self._generate_revision_from_feedback(
            original_draft=original_draft,
            user_feedback=user_feedback,
            style_card=style_card,
            rejected_entities=rejected_entities or [],
            memory_pack=memory_pack,
            config_agent="writer",
        )

    async def suggest_revision_selection(
        self,
        project_id: str,
        original_draft: str,
        selection_text: str,
        selection_occurrence: int,
        user_feedback: str,
        rejected_entities: List[str] = None,
        memory_pack: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        Suggest a revision scoped to an explicit selection (exact substring).
        生成“选区编辑”的修改建议：仅改动选区文本，返回整章 revised_content。
        """
        # Backward compatible method: locate by substring matching.
        original = normalize_newlines(original_draft)
        sel = normalize_newlines(selection_text)
        if not sel.strip():
            raise ValueError("选区编辑失败：选区为空")
        occurrence = max(int(selection_occurrence or 1), 1)
        start_cursor = 0
        pos = -1
        for _ in range(occurrence):
            pos = original.find(sel, start_cursor)
            if pos < 0:
                raise ValueError("选区编辑失败：未在正文中找到选区文本（请重新选中或缩小选区）")
            start_cursor = pos + len(sel)
        return await self.suggest_revision_selection_range(
            project_id=project_id,
            original_draft=original,
            selection_start=pos,
            selection_end=pos + len(sel),
            selection_text=sel,
            user_feedback=user_feedback,
            rejected_entities=rejected_entities,
            memory_pack=memory_pack,
        )

    async def suggest_revision_selection_range(
        self,
        project_id: str,
        original_draft: str,
        selection_start: int,
        selection_end: int,
        selection_text: Optional[str],
        user_feedback: str,
        rejected_entities: List[str] = None,
        memory_pack: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        Selection editing by explicit index range (most reliable).
        选区编辑（推荐）：前端提供 start/end，后端强制只替换该范围。
        """
        original = normalize_newlines(original_draft)
        start = int(selection_start or 0)
        end = int(selection_end or 0)
        start = max(0, min(start, len(original)))
        end = max(0, min(end, len(original)))
        if end <= start:
            raise ValueError("选区编辑失败：选区为空或无效")
        # Hard limit: avoid prompting with overly long selection which hurts reliability.
        if end - start > 3200:
            raise ValueError("选区编辑失败：选区过长（建议 ≤3200 字符），请缩小选区后再试")
        sel = original[start:end]
        if selection_text is not None:
            provided = normalize_newlines(selection_text)
            if provided and provided != sel:
                raise ValueError("选区编辑失败：选区内容已变化（请重新选中后再试）")
        style_card = await self.card_storage.get_style_card(project_id)
        context_items = []
        if style_card:
            try:
                context_items.append(f"Style: {style_card.style}")
            except (AttributeError, TypeError) as e:
                logger.warning("Failed to add style guidance: %s", e)
        if rejected_entities:
            context_items.append(
                "被拒绝概念：" + ", ".join(rejected_entities) + "\n" + EDITOR_REJECTED_CONCEPTS_INSTRUCTION
            )
        if memory_pack:
            context_items.extend(self._format_memory_pack_context(memory_pack))
        prefix_hint = original[max(0, start - 220):start]
        suffix_hint = original[end:min(len(original), end + 220)]
        prompt = editor_selection_replace_prompt(
            selection_text=sel,
            user_feedback=user_feedback,
            prefix_hint=prefix_hint,
            suffix_hint=suffix_hint,
            language=self.language,
        )

        messages = self.build_messages(
            system_prompt=prompt.system,
            user_prompt=prompt.user,
            context_items=context_items,
        )
        response = await self.call_llm(messages, config_agent="writer", return_meta=True)
        replacement = normalize_newlines(str(response.get("content") or "")).strip("\n")
        if not replacement.strip():
            raise ValueError("选区编辑失败：模型未生成替换文本（请缩小选区并更具体描述修改）")
        revised = (original[:start] + replacement + original[end:]).rstrip()
        if normalize_for_compare(revised) == normalize_for_compare(original):
            # One retry with stronger requirement
            retry_messages = list(messages)
            retry_messages.append({"role": "assistant", "content": str(response.get("content") or "")})
            retry_messages.append(
                {
                    "role": "user",
                    "content": "\n".join(
                        [
                            "你刚才输出的替换文本未产生任何可见修改。",
                            "请重新输出“替换后的选区文本”，并确保：",
                            "- 必须与选区原文不同",
                            "- 严格执行用户反馈",
                            "现在重新输出：",
                        ]
                    ),
                }
            )
            response2 = await self.call_llm(retry_messages, config_agent="writer", return_meta=True)
            replacement2 = normalize_newlines(str(response2.get("content") or "")).strip("\n")
            if not replacement2.strip():
                raise ValueError("选区编辑失败：模型未生成替换文本（重试后）")
            revised2 = (original[:start] + replacement2 + original[end:]).rstrip()
            if normalize_for_compare(revised2) == normalize_for_compare(original):
                raise ValueError("选区编辑失败：未能生成可应用差异（请缩小选区并更具体描述修改）")
            return revised2
        return revised

    def _format_memory_pack_context(self, memory_pack: Dict[str, Any]) -> List[str]:
        """Format memory pack into compact context items for the editor."""

        payload: Any = {}
        if isinstance(memory_pack, dict):
            payload = memory_pack.get("payload") or memory_pack.get("working_memory_payload") or {}
            if not payload and any(key in memory_pack for key in ("working_memory", "evidence_pack", "unresolved_gaps")):
                # Backward/compat: Orchestrator may pass the payload dict directly.
                payload = memory_pack
        if not isinstance(payload, dict):
            payload = {}
        context_items: List[str] = []
        digest = None
        if isinstance(memory_pack, dict):
            digest = memory_pack.get("chapter_digest")
        if isinstance(digest, dict):
            parts = []
            summary = str(digest.get("summary") or "").strip()
            if summary:
                parts.append("摘要：" + summary)
            top_chars = digest.get("top_characters") or []
            if isinstance(top_chars, list) and top_chars:
                parts.append("人物：" + "、".join([str(x).strip() for x in top_chars if str(x).strip()][:8]))
            top_world = digest.get("top_world") or []
            if isinstance(top_world, list) and top_world:
                parts.append("设定：" + "、".join([str(x).strip() for x in top_world if str(x).strip()][:8]))
            tail = str(digest.get("tail_excerpt") or "").strip()
            if tail:
                parts.append("结尾片段（用于续写对齐）：\n" + tail[:900])
            if parts:
                context_items.append("本章内容概览（压缩自本章正文）：\n" + "\n".join(parts))
        working_memory = payload.get("working_memory")
        if working_memory:
            context_items.append("工作记忆：\n" + str(working_memory).strip())
        evidence_pack = payload.get("evidence_pack") or {}
        evidence_items = evidence_pack.get("items") or []
        if evidence_items:

            def _score(item: Dict[str, Any]) -> float:
                try:
                    return float(item.get("score") or 0)
                except Exception:
                    return 0.0
            ordered = [item for item in evidence_items if isinstance(item, dict)]
            ordered.sort(key=_score, reverse=True)
            lines = []
            for item in ordered:
                text = str(item.get("text") or "").strip()
                if not text:
                    continue
                item_type = str(item.get("type") or "evidence")
                source = item.get("source") or {}
                source_parts = [
                    source.get("chapter"),
                    source.get("draft"),
                    source.get("path"),
                    source.get("field"),
                    source.get("fact_id"),
                    source.get("card"),
                    source.get("introduced_in"),
                ]
                source_label = " / ".join([str(part) for part in source_parts if part])
                line = f"[{item_type}] {text}"
                if source_label:
                    line += f" ({source_label})"
                lines.append(line)
                if len(lines) >= 6:
                    break
            if lines:
                context_items.append("证据摘录：\n" + "\n".join(lines))
        unresolved_gaps = payload.get("unresolved_gaps") or []
        if unresolved_gaps:
            gap_lines = []
            for gap in unresolved_gaps[:6]:
                if isinstance(gap, dict):
                    text = str(gap.get("text") or "").strip()
                else:
                    text = str(gap or "").strip()
                if text:
                    gap_lines.append(f"- {text}")
            if gap_lines:
                context_items.append("未解决缺口（请勿编造）：\n" + "\n".join(gap_lines))
        snapshot = None
        if isinstance(memory_pack, dict):
            snapshot = memory_pack.get("card_snapshot")
        if isinstance(snapshot, dict):
            context_items.extend(self._format_card_snapshot(snapshot))
        return context_items

    def _format_card_snapshot(self, snapshot: Dict[str, Any]) -> List[str]:
        characters = snapshot.get("characters") or []
        world = snapshot.get("world") or []
        style = snapshot.get("style")
        context_items: List[str] = []
        if characters:
            lines = []
            for item in characters[:8]:
                if not isinstance(item, dict):
                    continue
                name = str(item.get("name") or "").strip()
                if not name:
                    continue
                stars = item.get("stars")
                star_label = f"★{stars}" if stars else ""
                appearance = str(item.get("appearance") or "").strip()
                identity = str(item.get("identity") or "").strip()
                aliases = item.get("aliases") or []
                alias_text = "、".join([str(a).strip() for a in aliases if str(a).strip()][:4])
                parts = []
                if identity:
                    parts.append(f"身份：{identity}")
                if appearance:
                    parts.append(f"外貌：{appearance}")
                if alias_text:
                    parts.append(f"别名：{alias_text}")
                line = f"- {name}{star_label}"
                if parts:
                    line += "（" + "；".join(parts) + "）"
                lines.append(line)
            if lines:
                context_items.append("角色设定（快照）：\n" + "\n".join(lines))
        if world:
            lines = []
            for item in world[:8]:
                if not isinstance(item, dict):
                    continue
                name = str(item.get("name") or "").strip()
                if not name:
                    continue
                stars = item.get("stars")
                star_label = f"★{stars}" if stars else ""
                category = str(item.get("category") or "").strip()
                immutable = item.get("immutable")
                rules = item.get("rules") or []
                rule_text = "；".join([str(r).strip() for r in rules if str(r).strip()][:3])
                parts = []
                if category:
                    parts.append(f"类别：{category}")
                if isinstance(immutable, bool):
                    parts.append("不可变" if immutable else "可变")
                if rule_text:
                    parts.append(f"规则：{rule_text}")
                line = f"- {name}{star_label}"
                if parts:
                    line += "（" + "；".join(parts) + "）"
                lines.append(line)
            if lines:
                context_items.append("世界设定（快照）：\n" + "\n".join(lines))
        if isinstance(style, dict):
            style_text = str(style.get("style") or "").strip()
            if style_text:
                context_items.append("文风卡（快照）：\n" + style_text[:800])
        return context_items
