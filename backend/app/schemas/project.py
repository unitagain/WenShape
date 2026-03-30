"""
中文说明：该模块为 WenShape 后端组成部分，详细行为见下方英文说明。

Project schema models.
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.enums import WritingLanguage


class ProjectBase(BaseModel):
    """Shared fields for project models."""

    name: str = Field(..., description="Project name")
    description: Optional[str] = Field(default=None, description="Project description")
    language: WritingLanguage = Field(default=WritingLanguage.CHINESE, description="Writing language")


class ProjectCreate(ProjectBase):
    """Create project request model."""


class Project(ProjectBase):
    """Full project model."""

    id: str = Field(..., description="Project ID")
    created_at: datetime = Field(..., description="Creation timestamp")
    updated_at: datetime = Field(..., description="Last update timestamp")
    chapter_count: int = Field(default=0, description="Number of chapters")
    total_word_count: int = Field(default=0, description="Total word count")

    model_config = ConfigDict(from_attributes=True)


class ProjectStats(BaseModel):
    """Project statistics model."""

    total_word_count: int = Field(..., description="Total words")
    completed_chapters: int = Field(..., description="Completed chapters")
    in_progress_chapters: int = Field(..., description="In-progress chapters")
    character_count: int = Field(..., description="Number of characters")
    fact_count: int = Field(..., description="Number of facts")
