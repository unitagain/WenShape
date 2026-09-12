"""Regression tests for modular Archivist prompt template exports."""

from __future__ import annotations

from app.prompt_templates.archivist import (
    archivist_canon_updates_prompt,
    archivist_chapter_summary_prompt,
    archivist_fanfiction_card_prompt,
    archivist_fanfiction_card_repair_prompt,
    archivist_focus_characters_binding_prompt,
    archivist_style_profile_prompt,
    archivist_volume_summary_prompt,
    get_archivist_system_prompt,
)


def test_archivist_facade_exports_system_prompt() -> None:
    prompt = get_archivist_system_prompt("zh")
    assert "Archivist" in prompt
    assert "结构化" in prompt


def test_archivist_facade_exports_style_prompt() -> None:
    """U9：文风提炼产出「可直接注入的写作指令」，不再是 A-H 八节文学分析报告。

    冻结点：样本进 user、约束进 system、显式限长（文风卡每轮进 Writer 稳定前缀，
    长度直接换算为固定 token 成本），且要求覆盖视角/描写/癖好三类可辨识偏好。
    """

    prompt = archivist_style_profile_prompt("示例文本", language="zh")
    assert "示例文本" in prompt.user
    assert "文风提示词" in prompt.system
    assert "500 字" in prompt.system  # 显式限长
    assert "叙事视角" in prompt.system and "描写偏好" in prompt.system and "癖好" in prompt.system

    english = archivist_style_profile_prompt("sample", language="en")
    assert "sample" in english.user
    assert "STYLE PROMPT" in english.system


def test_archivist_facade_exports_fanfiction_prompts() -> None:
    extract_prompt = archivist_fanfiction_card_prompt("标题", "内容", language="zh")
    repair_prompt = archivist_fanfiction_card_repair_prompt("标题", "内容", hint="补全能力", language="zh")
    assert '"type": "Character|World"' in extract_prompt.user
    assert "补全能力" in repair_prompt.user


def test_archivist_facade_exports_summary_prompts() -> None:
    canon_prompt = archivist_canon_updates_prompt("1", "正文", language="zh")
    chapter_prompt = archivist_chapter_summary_prompt("1", "标题", "正文", language="zh")
    focus_prompt = archivist_focus_characters_binding_prompt(
        chapter="1",
        candidates=[{"name": "阿青", "stars": 3, "aliases": ["小青"]}],
        final_draft="阿青出场。",
        language="zh",
    )
    volume_prompt = archivist_volume_summary_prompt(
        volume_id="卷一",
        chapter_items=[{"chapter": "1", "brief_summary": "起始事件"}],
        language="zh",
    )

    assert "facts:" in canon_prompt.user
    assert "relations:" in canon_prompt.user  # Phase 4: 关系三元组抽取
    assert "context:" in canon_prompt.user  # Phase 4: 情境前缀
    assert "brief_summary:" in chapter_prompt.user
    assert "focus_characters:" in focus_prompt.user
    assert "volume_id: 卷一" in volume_prompt.user
