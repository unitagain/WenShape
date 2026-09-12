"""Regression: WriterToolset schemas must be a subset of the ContextPlan agentic_writer loadout.

失效模式（已两次发生，每次都让整条写作主路径 100% 不可用）：
Writer 暴露了某个工具，但 `tool_registry` 的 agentic_writer 路由没有登记它 →
`ContextPlan.validate_request` 视其为 disallowed tool 抛
`PermissionError("context_plan_disallowed_tools:<name>")` → 经 `safe_error_code`
归一为 `permission_denied` → 每轮撰写都是「本轮执行失败：permission_denied」。

- 第一次：U1 引入 `read_outline`。
- 第二次：`multi_asset=True` 暴露 `edit_chapter` / `write_chapter`，而旧测试用默认参数
  构造 toolset（`multi_asset=False`），恰好过滤掉这两个工具 → 测试全绿但生产全挂。

因此本测试必须**按 writing_service.run 的生产参数**构造，并覆盖 multi_asset 两种取值。
"""

from __future__ import annotations

import pytest

from app.agents.tools import WriterToolset
from app.agents.writing_actions import WritingActionToolset
from app.context_engine.tool_registry import get_tool_spec, tool_loadout_for_route


def _allowed_writer_tools() -> set[str]:
    return {str(item.get("name")) for item in tool_loadout_for_route("agentic_writer") if item.get("name")}


def _production_retrieval_toolset() -> WriterToolset:
    """与 orchestrator/writing_service.py 中 WriterToolset(...) 的构造参数保持一致。"""

    return WriterToolset(
        "p",
        None,
        None,
        current_chapter="V1C1",
        outline_enabled=True,
        defer_writes=True,
    )


def test_writer_retrieval_tools_are_all_allowed_in_agentic_writer_loadout():
    allowed = _allowed_writer_tools()
    retrieval = _production_retrieval_toolset()
    exposed = {s["function"]["name"] for s in retrieval.schemas()}
    # 大纲启用时 read_outline 也在 schema 里——必须被 loadout 允许。
    assert "read_outline" in exposed
    missing = exposed - allowed
    assert not missing, f"writer 检索工具不在 agentic_writer loadout 中（会触发 permission_denied）: {missing}"


@pytest.mark.parametrize("multi_asset", [False, True])
def test_full_writing_toolset_is_subset_of_loadout(multi_asset: bool):
    """两种 multi_asset 取值都必须是 loadout 的子集，避免再次「测试绿、生产挂」。"""

    allowed = _allowed_writer_tools()
    retrieval = _production_retrieval_toolset()
    writing = WritingActionToolset(
        "",
        retrieval_toolset=retrieval,
        active_chapter="V1C1",
        existing_chapters=["V1C1"],
        require_chapter_target=True,
        multi_asset=multi_asset,
    )
    exposed = {s["function"]["name"] for s in writing.schemas()}
    assert {"write_content", "edit_lines", "read_outline"} <= exposed
    if multi_asset:
        # 生产使用 multi_asset=True：跨章工具必须同时存在于 schema 与 loadout。
        assert {"edit_chapter", "write_chapter"} <= exposed
    missing = exposed - allowed
    assert not missing, f"写作工具集不在 agentic_writer loadout 中: {missing}"


def test_multi_asset_chapter_tools_are_registered_specs():
    """跨章工具必须是已注册 ToolSpec，否则 loadout 退化为 scope=unknown 的保守条目。"""

    for name in ("edit_chapter", "write_chapter"):
        spec = get_tool_spec(name)
        assert spec is not None, f"{name} 未在 tool_registry 注册"
        assert spec.read_only is False
        assert "agentic_writer" in spec.enabled_for


def test_read_outline_permission_is_allow_not_ask():
    # read_outline 是只读工具，应为 allow（与其它读工具一致），否则后台 actor 下 ask→deny。
    from app.utils.permissions import permission_for

    assert permission_for("read_outline") == "allow"
