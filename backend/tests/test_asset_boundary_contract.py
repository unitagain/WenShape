# -*- coding: utf-8 -*-
"""
文枢 WenShape - 深度上下文感知的智能体小说创作系统
WenShape - Deep Context-Aware Agent-Based Novel Writing System

Copyright © 2025-2026 WenShape Team
License: PolyForm Noncommercial License 1.0.0

模块说明 / Module Description:
  A1 项目资产边界合同测试 - 把「资产段拒绝式校验」从 project_id 扩展到
  卡名/章节ID/卷ID/索引名等拼接段（评估报告 F01）。
  A1 asset boundary contract tests - extend the reject-only guard from
  project_id to every path segment joined after it (finding F01).

为什么放在存储层并以真实类验证（V1-1 同款模式，见 test_path_traversal_contract.py）：
  ``BaseStorage.asset_path`` 是资产级路径的收敛点，逐路由/逐工具修会漏。
  合同必须覆盖：存储层拒绝、存量合法名仍可用、真实 WriterToolset 装配受限、
  HTTP 层 %2F 编码越界被拒——四层缺一不可（工具测试若只配 Fake adapter 则
  测不到存储层校验，这是已知测试盲区）。
"""

import asyncio

import pytest

from app.agents.tools import WriterToolset
from app.schemas.card import CharacterCard
from app.storage.cards import CardStorage
from app.storage.drafts import DraftStorage
from app.storage.evidence_index import EvidenceIndexStorage
from app.storage.memory_pack import MemoryPackStorage
from app.storage.bindings import ChapterBindingStorage
from app.storage.volumes import VolumeStorage
from app.utils.path_safety import UnsafeIdentifierError

# 攻击载荷：每条都必须被拒绝，且不得被改写为其他合法标识符。
# Attack payloads: each must be rejected outright, never rewritten.
ESCAPING_CARD_NAMES = [
    "../../../outside/cards/characters/ForeignCard",  # F01 原始复现载荷
    "..\\..\\outside",
    "/etc/passwd",
    "C:\\Windows\\evil",
    "a:b",  # NTFS 备用数据流 / NTFS alternate data stream
    "..",
    "name/../../other",
]

ESCAPING_CHAPTER_IDS = [
    "../../../outside",
    "..\\..\\outside",
    "/etc/passwd",
    "C:\\Windows\\evil",
    "a:b",
    "..",
]

ESCAPING_VOLUME_IDS = [
    "../../../outside",
    "..\\..\\outside",
    "/etc/passwd",
    "C:\\evil",
    "a:b",
    "..",
]

# 存量兼容：真实数据里的合法形态收紧校验后必须全部仍然可用（含中文）。
# Legacy-compatible values: all must keep working after the guard is tightened.
LEGACY_CARD_NAMES = ["千逸", "沈曼华", "Aria.Star", "卡-01"]
LEGACY_CHAPTER_IDS = ["V1C1", "V1C001", "c1"]  # c1 规范化为 V1C1
LEGACY_VOLUME_IDS = ["V1", "V2", "V10"]


def _storage(cls, tmp_path):
    return cls(str(tmp_path))


# --------------------------------------------------------------------------
# 存储层合同：拒绝越界资产段 / Storage contract: escaping segments rejected
# --------------------------------------------------------------------------


class TestCardStorageRejectsEscapingNames:
    @pytest.mark.parametrize("name", ESCAPING_CARD_NAMES)
    def test_read_rejected(self, tmp_path, name):
        storage = _storage(CardStorage, tmp_path)
        with pytest.raises(UnsafeIdentifierError):
            asyncio.run(storage.get_character_card("inside", name))
        with pytest.raises(UnsafeIdentifierError):
            asyncio.run(storage.get_world_card("inside", name))

    @pytest.mark.parametrize("name", ESCAPING_CARD_NAMES)
    def test_delete_rejected(self, tmp_path, name):
        storage = _storage(CardStorage, tmp_path)
        with pytest.raises(UnsafeIdentifierError):
            asyncio.run(storage.delete_character_card("inside", name))
        with pytest.raises(UnsafeIdentifierError):
            asyncio.run(storage.delete_world_card("inside", name))

    @pytest.mark.parametrize("name", ESCAPING_CARD_NAMES)
    def test_save_rejected(self, tmp_path, name):
        from app.schemas.card import WorldCard

        storage = _storage(CardStorage, tmp_path)
        with pytest.raises(UnsafeIdentifierError):
            asyncio.run(storage.save_character_card("inside", CharacterCard(name=name, description="x")))
        with pytest.raises(UnsafeIdentifierError):
            asyncio.run(storage.save_world_card("inside", WorldCard(name=name, description="x")))

    @pytest.mark.parametrize("name", LEGACY_CARD_NAMES)
    def test_legacy_names_roundtrip(self, tmp_path, name):
        """合法中文名/带点连字符名读写不受影响——收紧校验不得误伤存量。"""
        storage = _storage(CardStorage, tmp_path)
        asyncio.run(
            storage.save_character_card("inside", CharacterCard(name=name, description="哨兵内容SENTINEL"))
        )
        card = asyncio.run(storage.get_character_card("inside", name))
        assert card is not None and "SENTINEL" in str(card.description)


class TestDraftStorageRejectsInvalidChapterIds:
    @pytest.mark.parametrize("chapter", ESCAPING_CHAPTER_IDS)
    def test_path_helpers_rejected(self, tmp_path, chapter):
        storage = _storage(DraftStorage, tmp_path)
        with pytest.raises(UnsafeIdentifierError):
            storage.get_chapter_draft_dir("inside", chapter)

    @pytest.mark.parametrize("chapter", ESCAPING_CHAPTER_IDS)
    def test_read_rejected(self, tmp_path, chapter):
        storage = _storage(DraftStorage, tmp_path)
        with pytest.raises(UnsafeIdentifierError):
            asyncio.run(storage.get_final_draft("inside", chapter))
        with pytest.raises(UnsafeIdentifierError):
            asyncio.run(storage.get_scene_brief("inside", chapter))
        with pytest.raises(UnsafeIdentifierError):
            asyncio.run(storage.get_chapter_summary("inside", chapter))

    @pytest.mark.parametrize("chapter", ESCAPING_CHAPTER_IDS)
    def test_write_rejected(self, tmp_path, chapter):
        storage = _storage(DraftStorage, tmp_path)
        with pytest.raises(UnsafeIdentifierError):
            asyncio.run(storage.save_current_draft("inside", chapter, "正文"))

    @pytest.mark.parametrize("chapter", ESCAPING_CHAPTER_IDS)
    def test_working_text_stays_silent_empty(self, tmp_path, chapter):
        """get_working_text 是容错入口（吞 ValueError 返回空）——越界输入不得读出内容。"""
        storage = _storage(DraftStorage, tmp_path)
        text, path = asyncio.run(storage.get_working_text("inside", chapter))
        assert text == "" and path is None

    @pytest.mark.parametrize("chapter", LEGACY_CHAPTER_IDS)
    def test_legacy_chapters_roundtrip(self, tmp_path, chapter):
        storage = _storage(DraftStorage, tmp_path)
        asyncio.run(storage.save_current_draft("inside", chapter, "章节正文SENTINEL"))
        text = asyncio.run(storage.get_final_draft("inside", chapter))
        assert text is not None and "SENTINEL" in text


class TestVolumeAndIndexRejectEscapingIds:
    @pytest.mark.parametrize("volume_id", ESCAPING_VOLUME_IDS)
    def test_volume_rejected(self, tmp_path, volume_id):
        storage = _storage(VolumeStorage, tmp_path)
        with pytest.raises(UnsafeIdentifierError):
            asyncio.run(storage.get_volume("inside", volume_id))
        with pytest.raises(UnsafeIdentifierError):
            asyncio.run(storage.get_volume_summary("inside", volume_id))

    @pytest.mark.parametrize("volume_id", LEGACY_VOLUME_IDS)
    def test_legacy_volume_path_ok(self, tmp_path, volume_id):
        storage = _storage(VolumeStorage, tmp_path)
        path = storage._get_volume_file_path("inside", volume_id)
        assert path.name == f"{volume_id}.yaml"
        assert storage.get_project_path("inside") in path.parents

    @pytest.mark.parametrize("index_name", ["../../../outside", "..\\outside", "/etc", "a:b", ".."])
    def test_index_name_rejected(self, tmp_path, index_name):
        storage = _storage(EvidenceIndexStorage, tmp_path)
        with pytest.raises(UnsafeIdentifierError):
            storage.get_index_path("inside", index_name)
        with pytest.raises(UnsafeIdentifierError):
            storage.get_meta_path("inside", index_name)

    def test_index_name_constant_still_ok(self, tmp_path):
        storage = _storage(EvidenceIndexStorage, tmp_path)
        assert storage.get_index_path("inside", "cards").name == "cards.jsonl"


class TestBindingsAndMemoryPackRejectInvalidChapters:
    @pytest.mark.parametrize("chapter", ESCAPING_CHAPTER_IDS)
    def test_bindings_rejected(self, tmp_path, chapter):
        storage = _storage(ChapterBindingStorage, tmp_path)
        with pytest.raises(UnsafeIdentifierError):
            storage.get_bindings_path("inside", chapter)

    @pytest.mark.parametrize("chapter", ESCAPING_CHAPTER_IDS)
    def test_memory_pack_rejected(self, tmp_path, chapter):
        storage = _storage(MemoryPackStorage, tmp_path)
        with pytest.raises(UnsafeIdentifierError):
            storage.get_pack_path("inside", chapter)

    def test_valid_chapter_paths_ok(self, tmp_path):
        binding_path = _storage(ChapterBindingStorage, tmp_path).get_bindings_path("inside", "V1C3")
        assert binding_path.name == "bindings.yaml"
        pack_path = _storage(MemoryPackStorage, tmp_path).get_pack_path("inside", "V1C3")
        assert pack_path.name == "V1C3.json"


class TestCrossProjectIsolation:
    """F01 核心反例：inside 项目的存储实例绝不能读到 outside 项目的资产。"""

    @staticmethod
    def _setup_projects(tmp_path):
        outside = CardStorage(str(tmp_path))
        asyncio.run(outside.save_character_card("outside", CharacterCard(name="ForeignCard", description="外来哨兵FOREIGN_SENTINEL")))
        inside = CardStorage(str(tmp_path))
        asyncio.run(inside.save_character_card("inside", CharacterCard(name="千逸", description="内部哨兵INSIDE_SENTINEL")))
        return inside

    def test_relative_escape_cannot_read_outside(self, tmp_path):
        inside = self._setup_projects(tmp_path)
        # 校验发生在 exists() 之前：越界名直接拒绝，不会静默变成「未找到」
        with pytest.raises(UnsafeIdentifierError):
            asyncio.run(inside.get_character_card("inside", "../../../outside/cards/characters/ForeignCard"))

    def test_legal_name_only_reads_own_project(self, tmp_path):
        inside = self._setup_projects(tmp_path)
        # outside 里有 ForeignCard、inside 里没有——用合法名字也只能读到自己项目的资产
        assert asyncio.run(inside.get_character_card("inside", "ForeignCard")) is None
        card = asyncio.run(inside.get_character_card("inside", "千逸"))
        assert card is not None and "INSIDE_SENTINEL" in str(card.description)


# --------------------------------------------------------------------------
# 真实工具装配：WriterToolset + 真实存储（F01 探针复现）
# Real-tool assembly: WriterToolset over real storage classes
# --------------------------------------------------------------------------


class _FakeSelect:
    """SelectEngine 替身：lookup_card 边界测试不依赖检索引擎。"""

    async def retrieval_select(self, **kwargs):
        return []


def _real_toolset(tmp_path):
    """用真实 CardStorage + UnifiedStorageAdapter 装配 WriterToolset（生产同款链路）。"""
    from app.orchestrator.storage_adapter import UnifiedStorageAdapter
    from app.storage.canon import CanonStorage

    card = CardStorage(str(tmp_path))
    asyncio.run(card.save_character_card("outside", CharacterCard(name="ForeignCard", description="外来哨兵FOREIGN_SENTINEL")))
    asyncio.run(card.save_character_card("inside", CharacterCard(name="千逸", description="内部哨兵INSIDE_SENTINEL")))
    adapter = UnifiedStorageAdapter(
        card_storage=card,
        canon_storage=CanonStorage(str(tmp_path)),
        draft_storage=DraftStorage(str(tmp_path)),
    )
    return WriterToolset("inside", adapter, _FakeSelect(), current_chapter="V1C10", total_chapters=10)


class TestWriterToolsetRealStorageBoundary:
    def test_f01_probe_blocked(self, tmp_path):
        """F01 原始探针：越界卡名不得把其他项目内容送进模型上下文。"""
        toolset = _real_toolset(tmp_path)
        result = asyncio.run(toolset.execute("lookup_card", {"name": "../../../outside/cards/characters/ForeignCard"}))
        assert "FOREIGN_SENTINEL" not in result
        assert "tool_error" in result  # 明确失败可自纠，而非静默读出或假「未找到」

    @pytest.mark.parametrize(
        "payload",
        [
            "..\\..\\outside\\cards\\characters\\ForeignCard",
            "/abs/outside/ForeignCard",
            "C:\\outside\\ForeignCard",
        ],
    )
    def test_absolute_and_backslash_blocked(self, tmp_path, payload):
        toolset = _real_toolset(tmp_path)
        result = asyncio.run(toolset.execute("lookup_card", {"name": payload}))
        assert "FOREIGN_SENTINEL" not in result

    def test_read_chapter_escape_blocked(self, tmp_path):
        """read_chapter 的存储层异常被工具层吞为「暂无正文」——同样不得读出内容。"""
        toolset = _real_toolset(tmp_path)
        result = asyncio.run(toolset.execute("read_chapter", {"chapter_id": "../../../outside"}))
        assert "暂无正文" in result

    def test_legal_chinese_name_still_readable(self, tmp_path):
        """验收硬性要求：合法中文名经真实工具链仍可读。"""
        toolset = _real_toolset(tmp_path)
        result = asyncio.run(toolset.execute("lookup_card", {"name": "千逸"}))
        assert "INSIDE_SENTINEL" in result


# --------------------------------------------------------------------------
# HTTP 层：%2F 编码的越界卡名必须 400 且不泄露路径
# HTTP layer: %2F-encoded escaping names must 400 without leaking paths
# --------------------------------------------------------------------------


class TestHttpLayerRejectsEscapingCardName:
    @staticmethod
    def _call(path: str) -> dict:
        from app.main import app

        out: dict = {}

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            if message["type"] == "http.response.start":
                out["status"] = message["status"]
            elif message["type"] == "http.response.body":
                out["body"] = out.get("body", b"") + message.get("body", b"")

        scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "query_string": b"",
            "root_path": "",
            "headers": [(b"host", b"127.0.0.1")],
            "client": ("127.0.0.1", 1),
            "server": ("127.0.0.1", 8000),
        }
        asyncio.run(app(scope, receive, send))
        return out

    @pytest.mark.parametrize(
        "path",
        [
            "/api/projects/p1/cards/characters/..%2F..%2Foutside",
            "/api/projects/p1/cards/characters/..%2F..%2F..%2FWindows%2FTemp",
            "/api/projects/p1/cards/world/..%2Foutside%2Fcards%2Fworld%2FForeignCard",
        ],
    )
    def test_escaping_name_returns_400_without_leaking_path(self, path):
        result = self._call(path)
        assert result.get("status") == 400
        body = result.get("body", b"").decode("utf-8", "replace")
        assert "unsafe_card_name" in body
        assert "Github-WenShape" not in body
        assert "C:\\" not in body
