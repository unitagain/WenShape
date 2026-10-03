# -*- coding: utf-8 -*-
"""
文枢 WenShape - 深度上下文感知的智能体小说创作系统
WenShape - Deep Context-Aware Agent-Based Novel Writing System

Copyright © 2025-2026 WenShape Team
License: PolyForm Noncommercial License 1.0.0

模块说明 / Module Description:
  D1 多资产恢复协议合同测试 - journal 意图与恢复材料同事务持久化；
  记录失败不开工；部分成功后经 resume 幂等续做（磁盘核对、冲突停止、
  重复恢复安全）；显式部分成功，不承诺跨文件原子性、不自动回滚。
  D1 multi-asset recovery contract tests - journal intents persist with
  recovery material in one transaction; a failed intent record refuses to
  start the batch; partial success resumes idempotently (disk verification,
  conflict stops, repeat-safe); explicit partial success without
  cross-file atomicity or auto-rollback.
"""

import asyncio
import sqlite3

import pytest

from app.orchestrator.orchestrator import Orchestrator
from app.storage.drafts import DraftStorage


def _orch(tmp_path) -> Orchestrator:
    return Orchestrator(str(tmp_path))


def _changes(orch: Orchestrator, project_id: str, chapters: list):
    """构造与磁盘当前 revision/原文一致的两章 change set。"""
    draft: DraftStorage = orch.draft_storage
    changes = []
    for chapter in chapters:
        current, _ = asyncio.run(draft.get_working_text(project_id, chapter))
        revision = int((draft.get_draft_revision(project_id, chapter) or {}).get("revision") or 0)
        changes.append(
            {
                "asset_type": "chapter",
                "asset_id": chapter,
                "original": current,
                "revised": current + f"\n{chapter} 的新增段落RESUMED_{chapter}。",
                "base_revision": revision,
            }
        )
    return changes


def _seed_two_chapters(orch: Orchestrator, project_id: str = "p1"):
    draft = orch.draft_storage
    asyncio.run(draft.save_current_draft(project_id, "V1C001", "第一章原始正文。"))
    asyncio.run(draft.save_current_draft(project_id, "V1C002", "第二章原始正文。"))


class TestJournalMaterialAndStrictness:
    """意图与材料先持久化；记录失败不开工。"""

    def test_journal_stores_recovery_material(self, tmp_path):
        orch = _orch(tmp_path)
        _seed_two_chapters(orch)
        changes = _changes(orch, "p1", ["V1C001"])
        result = asyncio.run(orch.apply_change_set("p1", changes))
        assert result["success"] is True
        store = orch.change_set_journal_store()
        rows = store.journal_rows("p1")
        assert len(rows) == 1
        assert "RESUMED_V1C001" in str(rows[0].get("revised_content") or ""), "目标全文必须入 journal（D1）"
        assert "原始正文" in str(rows[0].get("original_content") or ""), "基线原文必须入 journal（恢复预览用）"

    def test_journal_record_failure_refuses_to_write(self, tmp_path, monkeypatch):
        """D1 核心语义：journal 配置可用但记录失败 → 不开始写入。"""
        orch = _orch(tmp_path)
        _seed_two_chapters(orch)
        changes = _changes(orch, "p1", ["V1C001"])

        store = orch.change_set_journal_store()

        def _broken_intent(*args, **kwargs):
            raise sqlite3.OperationalError("disk_full")

        monkeypatch.setattr(store, "record_write_intent", _broken_intent)
        result = asyncio.run(orch.apply_change_set("p1", changes))
        assert result["success"] is False
        assert result["reason"] == "write_journal_unavailable"
        # 磁盘未被写入：正文仍是基线。
        current, _ = asyncio.run(orch.draft_storage.get_working_text("p1", "V1C001"))
        assert "RESUMED" not in str(current or ""), "记录失败时不得开始该批写入"

    def test_store_unavailable_refuses_to_write(self, tmp_path, monkeypatch):
        """恢复材料无法持久化时，不允许开始批次。"""
        orch = _orch(tmp_path)
        _seed_two_chapters(orch)
        changes = _changes(orch, "p1", ["V1C001"])
        monkeypatch.setattr(orch, "_control_store_for_change_set", lambda: None)
        result = asyncio.run(orch.apply_change_set("p1", changes))
        assert result["success"] is False
        assert result["reason"] == "write_journal_unavailable"
        current, _ = asyncio.run(orch.draft_storage.get_working_text("p1", "V1C001"))
        assert "RESUMED_V1C001" not in str(current or "")


class TestPartialSuccessAndResume:
    """部分成功 + 续做协议。"""

    def test_partial_failure_then_resume_completes(self, tmp_path, monkeypatch):
        """第二个资产写失败 → 部分成功；resume 续做补齐。"""
        orch = _orch(tmp_path)
        _seed_two_chapters(orch)
        changes = _changes(orch, "p1", ["V1C001", "V1C002"])

        real_save = orch.draft_storage.save_current_draft
        calls = {"n": 0}

        async def _flaky_save(*args, **kwargs):
            calls["n"] += 1
            if calls["n"] == 2:
                raise RuntimeError("simulated_write_failure")
            return await real_save(*args, **kwargs)

        monkeypatch.setattr(orch.draft_storage, "save_current_draft", _flaky_save)
        result = asyncio.run(orch.apply_change_set("p1", changes))
        monkeypatch.setattr(orch.draft_storage, "save_current_draft", real_save)
        assert result["success"] is False
        assert len(result.get("applied") or []) == 1, "第一章已落盘（显式部分成功）"
        journal_id = result["journal_id"]

        # 恢复预览：第一章 already_applied，第二章 pending。
        preview = asyncio.run(orch.inspect_change_set_journal("p1"))
        assert preview["success"] is True
        journal = next(j for j in preview["journals"] if j["journal_id"] == journal_id)
        checks = {a["asset_id"]: a["check"]["result"] for a in journal["assets"]}
        assert checks.get("V1C001") == "already_applied"
        assert checks.get("V1C002") == "pending"

        # 续做：journal 已标记 applied 的 V1C001 不重处理；补齐第二章。
        resumed = asyncio.run(orch.resume_change_set("p1", journal_id))
        assert resumed["success"] is True, resumed
        assert [r["asset_id"] for r in resumed.get("resumed") or []] == ["V1C002"]
        for chapter in ("V1C001", "V1C002"):
            current, _ = asyncio.run(orch.draft_storage.get_working_text("p1", chapter))
            assert f"RESUMED_{chapter}" in str(current or "")

    def test_crash_between_write_and_journal_mark(self, tmp_path, monkeypatch):
        """崩溃窗口：写入成功但 journal 标记前崩溃 → resume 幂等收敛。"""
        orch = _orch(tmp_path)
        _seed_two_chapters(orch)
        changes = _changes(orch, "p1", ["V1C001"])
        store = orch.change_set_journal_store()

        # 模拟「写入成功、标记前崩溃」：标记操作静默丢失（journal 行保持 pending）。
        real_mark_applied = store.mark_write_applied
        monkeypatch.setattr(store, "mark_write_applied", lambda *args, **kwargs: None)
        result = asyncio.run(orch.apply_change_set("p1", changes))
        assert result["success"] is True, "写入实际成功（标记丢失不改变写入结果）"
        current, _ = asyncio.run(orch.draft_storage.get_working_text("p1", "V1C001"))
        assert "RESUMED_V1C001" in str(current or ""), "磁盘实际已写入（崩溃窗口前提）"
        monkeypatch.setattr(store, "mark_write_applied", real_mark_applied)

        # 重复恢复：磁盘已等于目标 → already_applied 幂等跳过，不二次写。
        journal_id = result["journal_id"]
        resumed = asyncio.run(orch.resume_change_set("p1", journal_id))
        assert resumed["success"] is True
        assert resumed.get("skipped") == 1 and not resumed.get("resumed")

    def test_user_edit_conflict_stops_resume(self, tmp_path, monkeypatch):
        """用户中途编辑（revision 漂移）→ 该资产冲突，停止续做。"""
        orch = _orch(tmp_path)
        _seed_two_chapters(orch)
        changes = _changes(orch, "p1", ["V1C001", "V1C002"])

        real_save = orch.draft_storage.save_current_draft
        calls = {"n": 0}

        async def _fail_second(*args, **kwargs):
            calls["n"] += 1
            if calls["n"] == 2:
                raise RuntimeError("simulated_write_failure")
            return await real_save(*args, **kwargs)

        monkeypatch.setattr(orch.draft_storage, "save_current_draft", _fail_second)
        result = asyncio.run(orch.apply_change_set("p1", changes))
        monkeypatch.setattr(orch.draft_storage, "save_current_draft", real_save)
        journal_id = result["journal_id"]

        # 用户在恢复前手工编辑第二章（revision 漂移）。
        asyncio.run(orch.draft_storage.save_current_draft("p1", "V1C002", "第二章被作者手工改过的版本。"))

        resumed = asyncio.run(orch.resume_change_set("p1", journal_id))
        assert resumed["success"] is False
        assert resumed["reason"] == "resume_revision_conflict"
        assert resumed.get("asset") == "V1C002"
        current, _ = asyncio.run(orch.draft_storage.get_working_text("p1", "V1C002"))
        assert "手工改过" in str(current or ""), "用户编辑不得被恢复协议覆盖"

    def test_repeat_resume_is_safe(self, tmp_path):
        """重复恢复：全部完成后再次 resume → all_applied，无重复写入。"""
        orch = _orch(tmp_path)
        _seed_two_chapters(orch)
        changes = _changes(orch, "p1", ["V1C001"])
        result = asyncio.run(orch.apply_change_set("p1", changes))
        assert result["success"] is True
        journal_id = result["journal_id"]
        again = asyncio.run(orch.resume_change_set("p1", journal_id))
        assert again["success"] is True
        assert again.get("reason") == "all_applied"

    def test_discard_supersedes_pending(self, tmp_path, monkeypatch):
        """放弃续做：未完成行 superseded，不再出现在恢复入口。"""
        orch = _orch(tmp_path)
        _seed_two_chapters(orch)
        changes = _changes(orch, "p1", ["V1C001", "V1C002"])

        real_save = orch.draft_storage.save_current_draft

        async def _fail_second(*args, **kwargs):
            if str(args[1] if len(args) > 1 else kwargs.get("chapter")) == "V1C002":
                raise RuntimeError("simulated_write_failure")
            return await real_save(*args, **kwargs)

        monkeypatch.setattr(orch.draft_storage, "save_current_draft", _fail_second)
        result = asyncio.run(orch.apply_change_set("p1", changes))
        monkeypatch.setattr(orch.draft_storage, "save_current_draft", real_save)
        assert result["success"] is False
        journal_id = result["journal_id"]

        discarded = asyncio.run(orch.discard_change_set_journal("p1", journal_id))
        assert discarded["success"] is True
        preview = asyncio.run(orch.inspect_change_set_journal("p1"))
        assert all(j["journal_id"] != journal_id for j in preview["journals"]), "superseded 不再出现在恢复入口"
        assert orch.change_set_journal_store().pending_writes("p1") == []
        resumed = asyncio.run(orch.resume_change_set("p1", journal_id))
        assert resumed["success"] is False
        assert resumed["reason"] == "journal_superseded"

    def test_resume_unknown_journal_fails_explicitly(self, tmp_path):
        orch = _orch(tmp_path)
        resumed = asyncio.run(orch.resume_change_set("p1", "nonexistent"))
        assert resumed["success"] is False
        assert resumed["reason"] == "journal_not_found"


def _pending_journal(orch, *, material=True):
    import hashlib

    item = {
        "asset_type": "chapter", "asset_id": "V1C001", "base_revision": 0,
        "content_sha256": hashlib.sha256("恢复正文".encode()).hexdigest(),
    }
    if material:
        item.update(original_content="", revised_content="恢复正文", chapter_target={"title": "恢复标题"})
    orch.change_set_journal_store().record_write_intent("recover", "p1", "", [item])


def test_legacy_hash_only_journal_never_writes_empty_content(tmp_path):
    orch = _orch(tmp_path)
    _pending_journal(orch, material=False)
    result = asyncio.run(orch.resume_change_set("p1", "recover"))
    assert result["success"] is False
    assert result["reason"] == "recovery_material_invalid"
    assert not (tmp_path / "p1" / "drafts" / "V1C001" / "final.md").exists()


def test_external_file_edit_without_revision_change_stops_resume(tmp_path):
    orch = _orch(tmp_path)
    _pending_journal(orch)
    path = tmp_path / "p1" / "drafts" / "V1C001" / "final.md"
    path.parent.mkdir(parents=True)
    path.write_text("作者直接编辑文件", encoding="utf-8")
    result = asyncio.run(orch.resume_change_set("p1", "recover"))
    assert result["success"] is False
    assert result["reason"] == "resume_revision_conflict"
    assert path.read_text(encoding="utf-8") == "作者直接编辑文件"


def test_resume_finishes_revision_and_summary_after_content_write_crash(tmp_path):
    orch = _orch(tmp_path)
    _pending_journal(orch)
    path = tmp_path / "p1" / "drafts" / "V1C001" / "final.md"
    path.parent.mkdir(parents=True)
    path.write_text("恢复正文", encoding="utf-8")
    result = asyncio.run(orch.resume_change_set("p1", "recover"))
    assert result["success"] is True
    assert orch.draft_storage.get_draft_revision("p1", "V1C001")["revision"] == 1
    summary = asyncio.run(orch.draft_storage.get_chapter_summary("p1", "V1C001"))
    assert summary is not None and summary.title == "恢复标题"
    assert summary.word_count == len("恢复正文")


def test_resume_write_race_returns_conflict_instead_of_name_error(tmp_path, monkeypatch):
    from app.control_plane.store import RevisionConflict

    orch = _orch(tmp_path)
    _pending_journal(orch)

    async def stale(*args, **kwargs):
        raise RevisionConflict("stale writer")

    monkeypatch.setattr(orch.draft_storage, "save_current_draft", stale)
    result = asyncio.run(orch.resume_change_set("p1", "recover"))
    assert result["success"] is False
    assert result["reason"] == "resume_revision_conflict"


def test_recovery_failure_with_unavailable_journal_is_structured(tmp_path, monkeypatch):
    orch = _orch(tmp_path)
    _pending_journal(orch)

    async def failed_write(*args, **kwargs):
        raise OSError("disk full")

    def failed_mark(*args, **kwargs):
        raise sqlite3.OperationalError("disk full")

    monkeypatch.setattr(orch.draft_storage, "save_current_draft", failed_write)
    monkeypatch.setattr(orch.change_set_journal_store(), "mark_write_failed", failed_mark)
    result = asyncio.run(orch.resume_change_set("p1", "recover"))
    assert result["success"] is False
    assert result["resumed"] == []


@pytest.mark.parametrize("chapter", ["V1C001", "V1C002"])
@pytest.mark.parametrize("after_write", [False, True])
async def test_each_asset_crash_boundary_recovers_after_restart(tmp_path, monkeypatch, chapter, after_write):
    orch = _orch(tmp_path)
    changes = [
        {"asset_type": "chapter", "asset_id": key, "original": "", "revised": f"正文{key}", "base_revision": 0}
        for key in ("V1C001", "V1C002")
    ]
    real_save = orch.draft_storage.save_current_draft

    async def crash(*args, **kwargs):
        if kwargs["chapter"] == chapter and not after_write:
            raise OSError("before asset write")
        result = await real_save(*args, **kwargs)
        if kwargs["chapter"] == chapter and after_write:
            raise OSError("after asset write")
        return result

    monkeypatch.setattr(orch.draft_storage, "save_current_draft", crash)
    applied = await orch.apply_change_set("p1", changes)
    assert applied["success"] is False
    if after_write:
        assert any(item["asset_id"] == chapter and item.get("recovery_pending") for item in applied["applied"])
    restarted = _orch(tmp_path)
    resumed = await restarted.resume_change_set("p1", applied["journal_id"])
    assert resumed["success"] is True
    for change in changes:
        text, _ = await restarted.draft_storage.get_working_text("p1", change["asset_id"])
        assert text == change["revised"]
        assert await restarted.draft_storage.get_chapter_summary("p1", change["asset_id"]) is not None
    assert restarted.change_set_journal_store().pending_writes("p1") == []


async def test_discard_fences_waiting_resume_and_preserves_material(tmp_path):
    orch = _orch(tmp_path)
    _pending_journal(orch)
    discarded, resumed = await asyncio.gather(
        orch.discard_change_set_journal("p1", "recover"),
        orch.resume_change_set("p1", "recover"),
    )
    assert discarded["success"] is True
    assert resumed["reason"] == "journal_superseded"
    assert (await orch.draft_storage.get_working_text("p1", "V1C001"))[0] == ""
    assert orch.change_set_journal_store().journal_rows("p1", "recover")[0]["revised_content"] == "恢复正文"


@pytest.mark.parametrize("operation", ["apply", "resume"])
async def test_summary_failure_reports_written_content_and_remains_recoverable(tmp_path, monkeypatch, operation):
    orch = _orch(tmp_path)

    async def fail_summary(*args, **kwargs):
        raise OSError("summary unavailable")

    monkeypatch.setattr(orch.draft_storage, "save_chapter_summary", fail_summary)
    if operation == "apply":
        result = await orch.apply_change_set("p1", [{
            "asset_type": "chapter", "asset_id": "V1C001", "original": "", "revised": "恢复正文", "base_revision": 0,
        }])
        journal_id = result["journal_id"]
    else:
        _pending_journal(orch)
        journal_id = "recover"
        result = await orch.resume_change_set("p1", journal_id)
    assert result["success"] is False
    written = result["applied" if operation == "apply" else "resumed"]
    assert written[0]["asset_id"] == "V1C001" and written[0]["recovery_pending"]
    restarted = _orch(tmp_path)
    assert restarted.change_set_journal_store().pending_writes("p1")
    assert (await restarted.resume_change_set("p1", journal_id))["success"] is True
    assert (await restarted.draft_storage.get_chapter_summary("p1", "V1C001")).word_count == len("恢复正文")
