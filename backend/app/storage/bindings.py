# -*- coding: utf-8 -*-
"""
文枢 WenShape - 深度上下文感知的智能体小说创作系统
WenShape - Deep Context-Aware Agent-Based Novel Writing System

Copyright © 2025-2026 WenShape Team
License: PolyForm Noncommercial License 1.0.0

模块说明 / Module Description:
  章节绑定存储 - 基于文件的章节实体绑定存储层，持久化角色/世界观的章节关联。
  Chapter bindings storage - File-based storage for chapter-to-entity associations (bindings).
"""

from typing import Any, Dict, Optional
from pathlib import Path

from app.storage.base import BaseStorage
from app.utils.chapter_id import ChapterIDValidator, normalize_chapter_id
from app.utils.path_safety import UnsafeIdentifierError


class ChapterBindingStorage(BaseStorage):
    """
    章节绑定存储层 - 基于文件的存储实现。

    Storage for chapter entity bindings (characters, world entities, world rules).
    Organizes bindings hierarchically by project, then by chapter.
    """

    def get_bindings_path(self, project_id: str, chapter: str) -> Path:
        """Return the bindings path for a chapter.

        Args:
            project_id: Target project id.
            chapter: Chapter id.

        Returns:
            Path to bindings file.

        Raises:
            UnsafeIdentifierError: 章节ID无法规范化为合法格式（拒绝，不回退原始串，A1）
                / If the chapter id cannot be canonicalized.
        """
        canonical = normalize_chapter_id(chapter)
        if not (canonical and ChapterIDValidator.validate(canonical)):
            raise UnsafeIdentifierError(
                "unsafe_chapter_id:invalid",
                code="unsafe_chapter_id",
                metadata={"reason": "invalid_or_empty"},
            )
        return self.asset_path(project_id, "index", "chapters", canonical, "bindings.yaml", field="chapter_id")

    async def read_bindings(self, project_id: str, chapter: str) -> Optional[Dict[str, Any]]:
        """Read bindings for a chapter.

        Args:
            project_id: Target project id.
            chapter: Chapter id.

        Returns:
            Binding payload if present.
        """
        path = self.get_bindings_path(project_id, chapter)
        if not path.exists():
            return None
        return await self.read_yaml(path)

    async def write_bindings(self, project_id: str, chapter: str, data: Dict[str, Any]) -> None:
        """Write bindings for a chapter.

        Args:
            project_id: Target project id.
            chapter: Chapter id.
            data: Binding payload.
        """
        path = self.get_bindings_path(project_id, chapter)
        await self.write_yaml(path, data)

    async def delete_bindings(self, project_id: str, chapter: str) -> bool:
        """Delete bindings for a chapter.

        Args:
            project_id: Target project id.
            chapter: Chapter id.

        Returns:
            True if bindings existed and were deleted.
        """
        path = self.get_bindings_path(project_id, chapter)
        if path.exists():
            path.unlink()
            # Also try to remove the parent directory if empty
            try:
                path.parent.rmdir()
            except OSError:
                pass
            return True
        return False
