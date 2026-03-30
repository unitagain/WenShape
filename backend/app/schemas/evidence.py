"""
中文说明：该模块为 WenShape 后端组成部分，详细行为见下方英文说明。

Evidence index models.
"""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class EvidenceItem(BaseModel):
    """Normalized evidence item for retrieval."""

    id: str = Field(..., description="Stable item id")
    type: str = Field(..., description="Evidence type")
    text: str = Field(..., description="Short, injectable text")
    source: Dict[str, Any] = Field(default_factory=dict, description="Source locator")
    scope: Optional[str] = Field(default=None, description="Scope hint")
    entities: List[str] = Field(default_factory=list, description="Entity hints")
    meta: Dict[str, Any] = Field(default_factory=dict, description="Extra metadata")


class EvidenceIndexMeta(BaseModel):
    """Metadata for an evidence index."""

    index_name: str
    built_at: float
    item_count: int
    source_mtime: Optional[float] = None
    details: Dict[str, Any] = Field(default_factory=dict)
