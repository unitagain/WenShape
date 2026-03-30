"""
Archivist prompt template facade exports.
"""

from .archivist_core import (
    archivist_style_profile_prompt,
    get_archivist_system_prompt,
)
from .archivist_fanfiction import (
    archivist_fanfiction_card_prompt,
    archivist_fanfiction_card_repair_prompt,
)
from .archivist_summary import (
    archivist_canon_updates_prompt,
    archivist_chapter_summary_prompt,
    archivist_focus_characters_binding_prompt,
    archivist_volume_summary_prompt,
)

__all__ = [
    "get_archivist_system_prompt",
    "archivist_style_profile_prompt",
    "archivist_fanfiction_card_prompt",
    "archivist_fanfiction_card_repair_prompt",
    "archivist_canon_updates_prompt",
    "archivist_chapter_summary_prompt",
    "archivist_focus_characters_binding_prompt",
    "archivist_volume_summary_prompt",
]
