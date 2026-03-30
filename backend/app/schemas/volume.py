"""
中文说明：分卷相关数据模型定义。

Volume schema models.
"""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class VolumeBase(BaseModel):
    """Shared fields for volume models."""

    title: str = Field(..., description="Volume title")
    summary: Optional[str] = Field(default=None, description="One-sentence volume summary")
    order: int = Field(default=0, description="Sort order")


class VolumeCreate(VolumeBase):
    """Create volume request."""


class Volume(VolumeBase):
    """Full volume model."""

    id: str = Field(..., description="Volume ID (V1, V2, ...)")
    project_id: str = Field(..., description="Project ID")
    created_at: datetime = Field(default_factory=datetime.now, description="Created timestamp")
    updated_at: datetime = Field(default_factory=datetime.now, description="Updated timestamp")

    model_config = ConfigDict(from_attributes=True)


class VolumeSummary(BaseModel):
    """Volume summary model."""

    volume_id: str = Field(..., description="Volume ID")
    brief_summary: str = Field(..., description="Brief summary")
    key_themes: List[str] = Field(default_factory=list, description="Key themes")
    major_events: List[str] = Field(default_factory=list, description="Major events")
    chapter_count: int = Field(default=0, description="Chapter count")
    created_at: datetime = Field(default_factory=datetime.now, description="Created timestamp")
    updated_at: datetime = Field(default_factory=datetime.now, description="Updated timestamp")

    model_config = ConfigDict(from_attributes=True)


class VolumeStats(BaseModel):
    """Volume stats model."""

    volume_id: str = Field(..., description="Volume ID")
    title: str = Field(..., description="Volume title")
    chapter_count: int = Field(default=0, description="Chapter count")
    total_words: int = Field(default=0, description="Total word count")
    created_at: datetime = Field(..., description="Created timestamp")
    updated_at: datetime = Field(..., description="Updated timestamp")
