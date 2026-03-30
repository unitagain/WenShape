"""
中文说明：卡片数据模型，定义角色/世界观/风格卡结构。

Card data models.
"""

from typing import List, Optional

from pydantic import BaseModel, Field


class CharacterCard(BaseModel):
    """Character card."""

    name: str = Field(..., description="Character name")
    aliases: List[str] = Field(default_factory=list, description="Character aliases")
    description: str = Field(..., description="Character description")
    stars: Optional[int] = Field(default=None, ge=1, le=3, description="Importance stars (1-3)")


class WorldCard(BaseModel):
    """World card."""

    name: str = Field(..., description="Setting name")
    description: str = Field(..., description="Setting description")
    aliases: List[str] = Field(default_factory=list, description="World aliases")
    category: Optional[str] = Field(default=None, description="World category")
    rules: List[str] = Field(default_factory=list, description="World rules")
    immutable: Optional[bool] = Field(default=None, description="Immutable flag")
    stars: Optional[int] = Field(default=None, ge=1, le=3, description="Importance stars (1-3)")


class StyleCard(BaseModel):
    """Writing style card."""

    style: str = Field(..., description="Writing style requirements")
