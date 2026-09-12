# -*- coding: utf-8 -*-
"""U9 · 多目标写作：意图识别、章节目标约束、plan 步骤只产提案。

现场故障（2026-08-12，`data/我的第一个项目`）：活动章节停在 V1C8（上一轮刚写第八章），
作者要求「对第一,二章的感官,细节描写深度优化拓展」，结果 V1C1 与 **V1C8** 同轮被改
（草稿 mtime 15:30:22 / 15:30:24），V1C2 根本没动。两个原因叠加：

1. `_detect_plan` 只认 ASCII 数字 + 范围连接符，「第一,二章」不命中 → 多目标退化为单轮 agentic。
2. `write_content`/`edit_lines` 目标隐式（= 活动章节），模型混用时静默落到 V1C8。

本文件锁死修复后的不变量。
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List

import pytest

from app.agents.intent import _detect_plan, classify_writing_intent, detect_target_chapter_numbers
from app.agents.planner import _drop_untargeted_steps, _fill_missing_chapters, _merge_same_chapter_steps
from app.agents.writing_actions import WritingActionToolset


class _FakeRetrieval:
    """提供跨章工具所需的 load_chapter_content（与 test_writing_actions 中的替身一致）。"""

    def schemas(self):
        return [{"type": "function", "function": {"name": "query_canon", "parameters": {}}}]

    async def execute(self, name, arguments):
        return f"[检索结果:{name}]"

    async def load_chapter_content(self, chapter):
        return {"V1C1": "第一章原文。", "V1C2": "第二章原文。", "V1C8": "第八章原文。"}.get(chapter, ""), 3


# --------------------------------------------------------------- 章节序号识别 --


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("对第一,二章的感官,细节描写深度优化拓展", [1, 2]),
        ("把第三章和第四章都改一下", [3, 4]),
        ("一、二章都要改", [1, 2]),
        ("1和2章一起改", [1, 2]),
        ("第8到10章统一润色", [8, 9, 10]),
        ("在6-8章回收第3章的伏笔", [6, 7, 8, 3]),
        ("第十一章和第十二章", [11, 12]),
        ("深度优化第一章,重点关注肉体描写", [1]),
        ("根据大纲撰写第八章", [8]),
        ("后面两章的剧情", []),  # 「两章」是数量词，不是序数
        ("改一下这里", []),
    ],
)
def test_detect_target_chapter_numbers(message: str, expected: List[int]):
    assert detect_target_chapter_numbers(message) == expected


@pytest.mark.parametrize(
    "message",
    [
        "对第一,二章的感官,细节描写深度优化拓展",  # 现场故障指令
        "把第三章和第四章都改一下",
        "一、二章都要改",
        "第8到10章统一润色",
    ],
)
def test_multi_target_instructions_route_to_plan(message: str):
    assert _detect_plan(message) is True


@pytest.mark.parametrize(
    "message",
    [
        "深度优化第一章,重点关注肉体描写",  # 单目标：必须保持单轮行为
        "在第二章中撰写：几年过去",
        "根据大纲撰写第八章",
        "后面两章的剧情",
        "改一下这里",
        "2000年哈佛大学的草坪上，20岁的千羽正坐在草坪上看书",  # 年份/年龄不得误判为章节
    ],
)
def test_single_target_instructions_stay_on_writer_path(message: str):
    assert _detect_plan(message) is False


def test_outline_edit_request_is_exempt_from_plan_route():
    """改大纲不是多章写作计划（既有豁免必须保持）。"""

    decision = asyncio.run(
        classify_writing_intent("在大纲中继续规划第七章和第八章的剧情", has_selection=False, has_draft=True)
    )
    assert decision["action"] != "plan"


# ----------------------------------------------------------- 章节目标约束 --


def _multi_asset_toolset(active: str = "V1C8") -> WritingActionToolset:
    """复刻生产构造（writing_service.run）：多资产 + 强制章节目标。"""

    return WritingActionToolset(
        "第八章原文。",
        retrieval_toolset=_FakeRetrieval(),
        active_chapter=active,
        existing_chapters=["V1C1", "V1C2", "V1C8"],
        require_chapter_target=True,
        multi_asset=True,
    )


def test_cross_chapter_edits_never_touch_the_active_chapter():
    """现场故障的精确回归：目标是 V1C1/V1C2 时，V1C8 绝不能出现在提案里。"""

    tools = _multi_asset_toolset(active="V1C8")

    asyncio.run(tools.execute("edit_chapter", {"chapter_id": "V1C1", "old_text": "原文", "new_text": "深化后的第一章"}))
    asyncio.run(tools.execute("edit_chapter", {"chapter_id": "V1C2", "old_text": "原文", "new_text": "深化后的第二章"}))

    assets = {item["asset_id"] for item in tools.change_proposals()}
    assert assets == {"V1C1", "V1C2"}
    assert "V1C8" not in assets
    assert tools.working_text == tools.original_text  # 活动章节工作副本未被污染


def test_write_content_requires_explicit_chapter_id():
    tools = _multi_asset_toolset()

    out = asyncio.run(tools.execute("write_content", {"content": "无目标正文"}))

    assert "chapter_id_required" in out
    assert tools.changed is False


def test_edit_lines_requires_explicit_chapter_id():
    tools = _multi_asset_toolset()

    out = asyncio.run(tools.execute("edit_lines", {"old_text": "第八章", "new_text": "改写"}))

    assert "chapter_id_required" in out
    assert tools.changed is False


@pytest.mark.parametrize(
    ("tool", "arguments", "alternative"),
    [
        ("write_content", {"chapter_id": "V1C1", "content": "串到别章的正文"}, "write_chapter"),
        ("edit_lines", {"chapter_id": "V1C1", "old_text": "第八章", "new_text": "x"}, "edit_chapter"),
    ],
)
def test_streaming_tools_refuse_other_chapters(tool: str, arguments: Dict[str, Any], alternative: str):
    """write_content/edit_lines 的正文会流式推进活动章节编辑器，故只能作用于活动章节。"""

    tools = _multi_asset_toolset(active="V1C8")

    out = asyncio.run(tools.execute(tool, arguments))

    assert "chapter_target_mismatch" in out
    assert alternative in out
    assert tools.changed is False


def test_active_chapter_write_still_works_with_explicit_id():
    tools = _multi_asset_toolset(active="V1C8")

    out = asyncio.run(tools.execute("write_content", {"chapter_id": "V1C8", "content": "重写第八章。"}))

    assert "写入" in out
    assert tools.working_text == "重写第八章。"


def test_simple_toolset_without_chapter_semantics_is_unaffected():
    """require_chapter_target=False 的简化工具集没有章节语义，不受新约束影响。"""

    tools = WritingActionToolset("旧正文")

    out = asyncio.run(tools.execute("edit_lines", {"old_text": "旧", "new_text": "新"}))

    assert "已替换" in out
    assert tools.working_text == "新正文"


# ------------------------------------------------------- planner 同章合并 --


def test_same_chapter_writing_steps_are_merged():
    """同章两个写作步骤会各自基于磁盘旧正文起算，后者覆盖前者的提案，故必须合并。"""

    merged = _merge_same_chapter_steps(
        [
            {"id": 1, "action": "edit", "chapter": "V1C1", "description": "深化感官描写", "title": ""},
            {"id": 2, "action": "edit", "chapter": "V1C1", "description": "补充细节", "title": "第一章"},
            {"id": 3, "action": "edit", "chapter": "V1C2", "description": "深化第二章", "title": ""},
        ]
    )

    assert [step["chapter"] for step in merged] == ["V1C1", "V1C2"]
    assert merged[0]["description"] == "深化感官描写；补充细节"
    assert merged[0]["title"] == "第一章"
    assert [step["id"] for step in merged] == [1, 2]  # id 重排保持连续


def test_research_steps_are_not_merged():
    merged = _merge_same_chapter_steps(
        [
            {"id": 1, "action": "research", "chapter": "", "description": "查伏笔", "title": ""},
            {"id": 2, "action": "research", "chapter": "", "description": "查关系", "title": ""},
            {"id": 3, "action": "write", "chapter": "V1C9", "description": "写第九章", "title": ""},
        ]
    )

    assert len(merged) == 3


def test_missing_chapter_is_filled_from_description():
    """模型常把「第一章」只写进 description；缺 chapter 的写作步骤会失败，故做确定性回填。"""

    steps = [
        {"id": 1, "action": "edit", "chapter": "", "description": "对第一章进行感官、细节描写的深度优化拓展"},
        {"id": 2, "action": "edit", "chapter": "", "description": "对第二章进行感官、细节描写的深度优化拓展"},
    ]

    filled = _fill_missing_chapters(steps, ["V1C1", "V1C2", "V1C8"])

    assert [step["chapter"] for step in filled] == ["V1C1", "V1C2"]


def test_ambiguous_or_unmatched_chapter_is_left_empty():
    """宁可留空报错，也不写错章：序号不唯一或跨卷同号时不回填。"""

    filled = _fill_missing_chapters(
        [
            {"id": 1, "action": "edit", "chapter": "", "description": "统一润色第一章和第二章"},  # 两个序号
            {"id": 2, "action": "edit", "chapter": "", "description": "优化第九章"},  # 无匹配章节
            {"id": 3, "action": "edit", "chapter": "", "description": "优化第一章"},  # 跨卷同号
        ],
        ["V1C1", "V2C1", "V1C2"],
    )

    assert [step["chapter"] for step in filled] == ["", "", ""]


def test_existing_chapter_field_is_never_overwritten():
    filled = _fill_missing_chapters(
        [{"id": 1, "action": "edit", "chapter": "V1C8", "description": "优化第一章"}],
        ["V1C1", "V1C8"],
    )

    assert filled[0]["chapter"] == "V1C8"


def test_untargeted_writing_steps_are_dropped_at_generation():
    """模型爱追加「分析这几章定稿」这类跨章步骤，chapter 必空 → 执行期必失败，故不入计划。"""

    kept = _drop_untargeted_steps(
        [
            {"id": 1, "action": "edit", "chapter": "V1C1", "description": "优化第一章"},
            {"id": 2, "action": "edit", "chapter": "V1C2", "description": "优化第二章"},
            {"id": 3, "action": "analyze", "chapter": "", "description": "分析这几章的定稿"},
        ]
    )

    assert [step["action"] for step in kept] == ["edit", "edit"]
    assert [step["id"] for step in kept] == [1, 2]  # id 重排保持连续


def test_research_steps_survive_without_chapter():
    """research 无需 chapter；write 新章时 chapter 本就应为空，两者都不能被误删。"""

    kept = _drop_untargeted_steps(
        [
            {"id": 1, "action": "research", "chapter": "", "description": "查证千羽的设定"},
            {"id": 2, "action": "write", "chapter": "", "description": "写新章"},
            {"id": 3, "action": "analyze", "chapter": "", "description": "分析这几章"},
        ]
    )

    assert [step["action"] for step in kept] == ["research", "write"]


# ------------------------------------------- plan 步骤只产提案、不落盘（U8 不变量） --


class _StagingWriter:
    """写作服务替身：返回 change_set，不触碰磁盘。"""

    def __init__(self):
        self.calls: List[tuple[str, str]] = []

    async def run(self, project_id: str, chapter: str, message: str, **kwargs: Any) -> Dict[str, Any]:
        self.calls.append((chapter, message))
        return {
            "success": True,
            "changed": True,
            "terminal_state": "completed",
            "agent_run": {"iterations": 4},
            "change_set": [
                {
                    "asset_type": "chapter",
                    "asset_id": chapter,
                    "original": f"{chapter} 原文",
                    "revised": f"{chapter} 新文",
                    "base_revision": 1,
                }
            ],
        }


def test_plan_writing_step_stages_proposals_without_writing_disk(tmp_path):
    """U8 不变量「所有写入先形成 proposal/diff」必须覆盖 plan 路径。"""

    from app.orchestrator.orchestrator import Orchestrator

    orch = Orchestrator(str(tmp_path))
    writer = _StagingWriter()
    orch.plan_execution_service.writing_service = writer

    saved: List[Any] = []

    async def _forbid_save(*args: Any, **kwargs: Any):
        saved.append((args, kwargs))
        raise AssertionError("plan 步骤不得直接落盘")

    orch.plan_execution_service.draft_storage.save_current_draft = _forbid_save

    step = {"id": 1, "action": "edit", "chapter": "V1C1", "description": "深化第一章", "status": "pending"}
    result = asyncio.run(orch.plan_execution_service.run_plan_step("proj", step))

    assert saved == []
    assert writer.calls == [("V1C1", "深化第一章")]
    assert step["change_set"][0]["asset_id"] == "V1C1"
    assert step["iterations"] == 4
    assert step["terminal_state"] == "completed"
    assert "staged" in result


def test_plan_writing_step_records_incomplete_terminal_state(tmp_path):
    """截断（max_iterations）必须显式记录，不得伪装完成。"""

    from app.orchestrator.orchestrator import Orchestrator

    orch = Orchestrator(str(tmp_path))

    class _Truncated:
        async def run(self, project_id, chapter, message, **kwargs):
            return {
                "success": True,
                "changed": False,
                "terminal_state": "incomplete",
                "reason": "max_iterations",
                "agent_run": {"iterations": 12},
            }

    orch.plan_execution_service.writing_service = _Truncated()
    step = {"id": 1, "action": "edit", "chapter": "V1C1", "description": "深化", "status": "pending"}

    result = asyncio.run(orch.plan_execution_service.run_plan_step("proj", step))

    assert step["terminal_state"] == "incomplete"
    assert step["iterations"] == 12
    assert "incomplete" in result
