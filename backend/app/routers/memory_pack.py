"""
Memory Pack Router / 章节记忆包接口
"""

from fastapi import APIRouter

from app.dependencies import get_memory_pack_storage

router = APIRouter(tags=["memory_pack"])
_storage = get_memory_pack_storage()


@router.get("/projects/{project_id}/memory-pack/{chapter}")
async def get_memory_pack_status(project_id: str, chapter: str):
    """Get memory pack status for a chapter."""
    pack = await _storage.read_pack(project_id, chapter)
    return _storage.build_status(chapter, pack)
