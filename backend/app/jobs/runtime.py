"""Application durable queue singleton and built-in handlers."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional

from app.config import settings
from app.control_plane.runtime import get_control_store
from app.jobs.durable_queue import DurableTaskQueue, DurableTaskWorker


_queue: Optional[DurableTaskQueue] = None
_worker: Optional[DurableTaskWorker] = None


def get_task_queue() -> DurableTaskQueue:
    global _queue
    if _queue is None:
        root = Path(settings.data_dir)
        if not root.is_absolute():
            root = (Path(__file__).resolve().parents[2] / root).resolve()
        _queue = DurableTaskQueue(root / "_system" / "task_queue", store=get_control_store())
    return _queue


async def enqueue_session_compact(
    project_id: str, *, history_count: int, conversation_id: str = ""
) -> Dict[str, Any]:
    """入队后台压缩任务；会话身份在入队时解析并写入 payload 与幂等 key（A2，F05）。

    幂等 key 含 conversation_id：同一项目不同会话各自计数触发互不抵消；
    worker 执行期间活动会话切换也不改变压缩目标。
    """
    return await get_task_queue().enqueue(
        "session_compact",
        {
            "project_id": project_id,
            "history_count": int(history_count),
            "conversation_id": str(conversation_id or ""),
        },
        idempotency_key=f"session_compact:{project_id}:{conversation_id or 'legacy'}:{history_count}",
        max_attempts=3,
    )


async def start_task_worker() -> None:
    global _worker
    if _worker is None:
        _worker = DurableTaskWorker(get_task_queue(), {"session_compact": _handle_session_compact})
    await _worker.start()


async def stop_task_worker() -> None:
    if _worker is not None:
        await _worker.stop()


def task_worker_status() -> Dict[str, Any]:
    return _worker.snapshot() if _worker is not None else {"running": False, "active_job": "", "last_error": ""}


async def _handle_session_compact(payload: Dict[str, Any]) -> Dict[str, Any]:
    from app.dependencies import get_orchestrator

    project_id = str(payload.get("project_id") or "")
    if not project_id:
        raise ValueError("missing_project_id")
    # 会话身份以入队时的 payload 为准，不重新解析当前 active（A2）。
    conversation_id = str(payload.get("conversation_id") or "")
    orchestrator = get_orchestrator(project_id)
    return await orchestrator.application.commands.run(
        project_id=project_id,
        chapter="",
        intent="compact",
        route_path="compress",
        target_word_count=512,
        conversation_id=conversation_id,
        operation=lambda: orchestrator.application.conversation.compact(
            project_id, conversation_id=conversation_id
        ),
    )
