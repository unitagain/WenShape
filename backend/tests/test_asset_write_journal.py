# -*- coding: utf-8 -*-
"""
评估修复回归（P7 多资产 change set 写入意图日志）。

apply_change_set 的 preflight 原子、顺序写入不是；journal 在写入前记录全部意图
（pending）、逐资产标记 applied/failed——部分应用从此可查询、可审计。
不实现自动回滚/续做（文件真相源经 Git 恢复；完整恢复流程属独立设计）。
"""

import asyncio

from app.control_plane.store import SQLiteControlStore
from app.error_contract import safe_error_code
from app.orchestrator.orchestrator import Orchestrator


def _items(*specs):
    return [{"asset_type": t, "asset_id": i, "base_revision": r, "content_sha256": f"hash-{t}-{i}"} for t, i, r in specs]


def test_record_intent_marks_all_pending(tmp_path):
    store = SQLiteControlStore(tmp_path / "control.sqlite3")
    store.record_write_intent("j1", "p", "turn-1", _items(("chapter", "V1C001", 3), ("outline", "outline", 0)))
    pending = store.pending_writes("p")
    assert len(pending) == 2
    assert all(row["status"] == "pending" for row in pending)
    assert {row["turn_id"] for row in pending} == {"turn-1"}


def test_applied_and_failed_lifecycle(tmp_path):
    store = SQLiteControlStore(tmp_path / "control.sqlite3")
    store.record_write_intent("j1", "p", "turn-1", _items(("chapter", "V1C001", 0), ("chapter", "V1C002", 0)))
    store.mark_write_applied("j1", "chapter", "V1C001")
    store.mark_write_failed("j1", "chapter", "V1C002", "disk_write_failed")

    pending = store.pending_writes("p")
    assert len(pending) == 1
    assert pending[0]["asset_id"] == "V1C002"
    assert pending[0]["status"] == "failed"
    assert pending[0]["error"] == "disk_write_failed"


def test_pending_writes_scoped_to_project(tmp_path):
    store = SQLiteControlStore(tmp_path / "control.sqlite3")
    store.record_write_intent("j1", "p1", "", _items(("chapter", "V1C001", 0)))
    store.record_write_intent("j2", "p2", "", _items(("chapter", "V1C001", 0)))
    assert {row["project_id"] for row in store.pending_writes("p1")} == {"p1"}


def test_all_success_yields_no_pending(tmp_path):
    store = SQLiteControlStore(tmp_path / "control.sqlite3")
    store.record_write_intent("j1", "p", "", _items(("chapter", "V1C001", 0)))
    store.mark_write_applied("j1", "chapter", "V1C001")
    assert store.pending_writes("p") == []


# ---------------------------------------------------- apply_change_set 集成 ----


def _journal_store_for(data_dir) -> SQLiteControlStore:
    """直接打开 journal 落点的控制平面库（与 _control_store_for_change_set 同一路径约定）。"""
    return SQLiteControlStore(data_dir / "_system" / "control.sqlite3")


def _chapter_proposal(chapter, original, revised, revision):
    return {
        "asset_type": "chapter",
        "asset_id": chapter,
        "original": original,
        "revised": revised,
        "base_revision": revision,
    }


def test_apply_change_set_journals_success(tmp_path):
    orchestrator = Orchestrator(str(tmp_path))
    asyncio.run(orchestrator.draft_storage.save_current_draft("p", "V1C001", "旧正文", 3))
    revision = int(orchestrator.draft_storage.get_draft_revision("p", "V1C001")["revision"])
    result = asyncio.run(orchestrator.apply_change_set("p", [_chapter_proposal("V1C001", "旧正文", "新正文", revision)]))
    assert result["success"] is True
    assert result["journal_id"]

    assert _journal_store_for(tmp_path).pending_writes("p") == [], "全部成功后无未结清意图"


def test_apply_change_set_journals_partial_failure(tmp_path):
    """第二资产写失败：第一已落盘（applied）、第二 failed——部分应用可审计。"""
    orchestrator = Orchestrator(str(tmp_path))
    asyncio.run(orchestrator.draft_storage.save_current_draft("p", "V1C001", "旧一", 2))
    asyncio.run(orchestrator.draft_storage.save_current_draft("p", "V1C002", "旧二", 2))
    revision_one = int(orchestrator.draft_storage.get_draft_revision("p", "V1C001")["revision"])
    revision_two = int(orchestrator.draft_storage.get_draft_revision("p", "V1C002")["revision"])

    original_save = orchestrator.draft_storage.save_current_draft
    calls = {"n": 0}

    async def flaky_second(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("injected_disk_failure")
        return await original_save(*args, **kwargs)

    orchestrator.draft_storage.save_current_draft = flaky_second
    try:
        result = asyncio.run(
            orchestrator.apply_change_set(
                "p",
                [
                    _chapter_proposal("V1C001", "旧一", "新一", revision_one),
                    _chapter_proposal("V1C002", "旧二", "新二", revision_two),
                ],
            )
        )
    finally:
        orchestrator.draft_storage.save_current_draft = original_save

    assert result["success"] is False
    # reason 走 error contract 的 classify_exception（未知异常归一化为 internal_error）
    assert result["reason"] == safe_error_code(RuntimeError("injected_disk_failure"))
    assert [row["asset_id"] for row in result["applied"]] == ["V1C001"]

    pending = _journal_store_for(tmp_path).pending_writes("p")
    assert len(pending) == 1
    assert pending[0]["asset_id"] == "V1C002"
    assert pending[0]["status"] == "failed"
    assert pending[0]["error"] == safe_error_code(RuntimeError("injected_disk_failure"))


def test_apply_change_set_journals_revision_conflict(tmp_path):
    """preflight 失败（revision_conflict）在写入前返回，无 journal 记录、无副作用。"""
    orchestrator = Orchestrator(str(tmp_path))
    asyncio.run(orchestrator.draft_storage.save_current_draft("p", "V1C001", "旧正文", 3))
    revision = int(orchestrator.draft_storage.get_draft_revision("p", "V1C001")["revision"])
    result = asyncio.run(
        orchestrator.apply_change_set("p", [_chapter_proposal("V1C001", "已被作者改过的正文", "新正文", revision)])
    )
    assert result["success"] is False
    assert result["reason"] == "revision_conflict"
    # preflight 原子失败：没有任何资产进入写入循环，journal 不应有未结清意图。
    assert _journal_store_for(tmp_path).pending_writes("p") == []


def test_journal_store_isolated_to_orchestrator_data_dir(tmp_path):
    """Orchestrator(tmp_path) 的 journal 落在其自身 data_dir，不触碰全局单例路径。"""
    orchestrator = Orchestrator(str(tmp_path))
    asyncio.run(orchestrator.draft_storage.save_current_draft("p", "V1C001", "旧", 1))
    revision = int(orchestrator.draft_storage.get_draft_revision("p", "V1C001")["revision"])
    result = asyncio.run(orchestrator.apply_change_set("p", [_chapter_proposal("V1C001", "旧", "新", revision)]))
    assert result["success"] is True
    assert (tmp_path / "_system" / "control.sqlite3").is_file(), "journal 必须落在 orchestrator 自身 data_dir"
