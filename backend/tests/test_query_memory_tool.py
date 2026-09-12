# -*- coding: utf-8 -*-
"""
评估修复回归（P1 接通 Memory 召回）。

Writer 此前只有卡片目录（B1）而无记忆目录与记忆工具——Memory 内核「只写不读」。
本文件冻结接通后的合同：
  ① query_memory 工具只返回 eligible 记忆（needs_review/rejected 不出现）；
  ② memory_storage=None 时能力降级而非报错；
  ③ 记忆目录推送有界、超限显式标注剩余条数（与 B1 同构，不静默截断）；
  ④ 工具在 agentic_writer loadout 中登记（permission 放行）。
"""

import asyncio

from app.agents.tools import WriterToolset
from app.context_engine.tool_registry import get_tool_spec, tool_loadout_for_route
from app.orchestrator.writing_service import WritingService
from app.storage.creative_memory import CreativeMemoryStorage

# 哨兵：区分「未传 storage（默认建真实存储）」与「显式传 None（降级路径）」。
_DEFAULT = object()


def _toolset(tmp_path, storage=_DEFAULT) -> WriterToolset:
    return WriterToolset(
        "p1",
        None,
        None,
        current_chapter="V1C001",
        outline_enabled=True,
        defer_writes=True,
        memory_storage=CreativeMemoryStorage(str(tmp_path)) if storage is _DEFAULT else storage,
    )


def test_query_memory_returns_only_eligible_memories(tmp_path):
    storage = CreativeMemoryStorage(str(tmp_path))
    asyncio.run(storage.write_memory("p1", "tone", "作者偏好冷峻克制的文风", "避免煽情与感叹号", "preference"))
    asyncio.run(
        storage.write_candidate_memory("p1", "auto-tone", "AI 推断偏好短句", "待审核正文", "preference")
    )
    asyncio.run(
        storage.write_candidate_memory("p1", "bad", "误抽取的错误偏好", "将被拒绝", "preference")
    )
    asyncio.run(storage.reject_memory("p1", "bad"))

    toolset = _toolset(tmp_path, storage)
    result = asyncio.run(toolset.execute("query_memory", {"query": "文风偏好", "top_k": 5}))

    assert "冷峻克制" in result, "active 记忆应被召回"
    assert "待审核正文" not in result, "needs_review 记忆不得进入工具输出"
    assert "将被拒绝" not in result, "rejected 记忆不得进入工具输出"


def test_query_memory_no_hit_returns_readable_empty(tmp_path):
    toolset = _toolset(tmp_path)
    result = asyncio.run(toolset.execute("query_memory", {"query": "完全不相关的查询词xyzq", "top_k": 3}))
    assert "未检索到" in result


def test_query_memory_degrades_without_storage(tmp_path):
    toolset = _toolset(tmp_path, storage=None)
    result = asyncio.run(toolset.execute("query_memory", {"query": "文风"}))
    assert "不可用" in result, "记忆库缺位应能力降级，而非抛错中断 agentic 循环"


def test_query_memory_requires_query_argument(tmp_path):
    toolset = _toolset(tmp_path)
    result = asyncio.run(toolset.execute("query_memory", {"top_k": 3}))
    assert "需要 query 参数" in result


def test_query_memory_registered_in_agentic_writer_loadout():
    """漏登记即整轮 permission_denied（U1/U9 两次事故的合同冻结）。"""
    spec = get_tool_spec("query_memory")
    assert spec is not None, "query_memory 未在 tool_registry 注册"
    assert spec.read_only is True
    assert "agentic_writer" in spec.enabled_for
    allowed = {item["name"] for item in tool_loadout_for_route("agentic_writer")}
    assert "query_memory" in allowed
    # 工具 schema 与 registry 同步（loadout 回归测试也会抓，这里显式冻结）。
    names = {s["function"]["name"] for s in _toolset(None, storage=object()).schemas()}
    assert "query_memory" in names


def test_query_memory_result_is_recoverable():
    assert WriterToolset.is_result_recoverable("query_memory") is True


# ------------------------------------------------- 记忆目录推送（B1 同构）----


def _writing_service(memory_storage) -> WritingService:
    return WritingService(
        gateway=None,
        writer=None,
        draft_storage=None,
        storage_adapter=None,
        select_engine=None,
        context_assembly=None,
        memory_storage=memory_storage,
    )


def test_memory_inventory_push_lists_active_headers_only(tmp_path):
    storage = CreativeMemoryStorage(str(tmp_path))
    asyncio.run(storage.write_memory("p1", "tone", "偏好冷峻文风", "…", "preference"))
    asyncio.run(storage.write_candidate_memory("p1", "auto", "待审核记忆", "…", "preference"))

    push = asyncio.run(_writing_service(storage)._resolve_memory_inventory_push("p1"))
    assert "偏好冷峻文风" in push
    assert "待审核记忆" not in push, "目录只列 active——与召回 eligible 口径一致"


def test_memory_inventory_push_empty_without_memories(tmp_path):
    storage = CreativeMemoryStorage(str(tmp_path))
    push = asyncio.run(_writing_service(storage)._resolve_memory_inventory_push("p1"))
    assert push == ""


def test_memory_inventory_push_empty_without_storage():
    assert asyncio.run(_writing_service(None)._resolve_memory_inventory_push("p1")) == ""


def test_memory_inventory_push_overflow_is_explicit(tmp_path):
    storage = CreativeMemoryStorage(str(tmp_path))
    for i in range(5):
        asyncio.run(storage.write_memory("p1", f"m{i}", f"偏好条目{i}", "…", "preference"))
    service = _writing_service(storage)

    # get_config() 带 lru_cache，返回的是同一 dict 对象：临时改写并恢复即可。
    from app.config import get_config

    data = get_config()
    retrieval = data.setdefault("retrieval", {})
    prev = retrieval.get("memory_inventory_max_items")
    retrieval["memory_inventory_max_items"] = 2
    try:
        push = asyncio.run(service._resolve_memory_inventory_push("p1"))
    finally:
        if prev is None:
            retrieval.pop("memory_inventory_max_items", None)
        else:
            retrieval["memory_inventory_max_items"] = prev

    assert "另有 3 条记忆未列出" in push, "超限必须显式标注剩余条数（不静默截断）"
    assert "query_memory" in push


def test_memory_inventory_bucket_in_supply_report(tmp_path):
    """目录推送经装配进 supply_report 的 memory_inventory 桶（B1 归桶同构）。"""
    from app.orchestrator.context_assembly_service import ContextAssemblyService

    service = ContextAssemblyService()
    request = service.assemble_writer_request(
        message="写下一章",
        chapter="V1C001",
        current_text="",
        has_selection=False,
        target_word_count=1000,
        card_inventory_push="- [角色] 林舟",
        memory_inventory_push="- [preference/project] tone：偏好冷峻文风",
    )
    assert "memory_inventory" in request.supply_report.available
    assert "memory_inventory" in request.supply_report.pushed
    assert "【创作记忆目录（既往偏好与决定索引）】" in request.messages[0]["content"]
    assert "query_memory" in request.messages[0]["content"]
