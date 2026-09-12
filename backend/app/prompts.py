"""
中文说明：该模块为 WenShape 后端组成部分，详细行为见下方英文说明。

Backward-compatible prompt exports.
"""

from app.prompt_templates.archivist import *  # noqa: F401,F403
from app.prompt_templates.retrieval import *  # noqa: F401,F403
from app.prompt_templates.shared import *  # noqa: F401,F403
# prompt_templates/writer.py 已删除（评估 P5）：get_writer_system_prompt 描述的是
# 已移除的 legacy 5 阶段架构且全仓零调用；Writer 系统提示的现 owner 是
# orchestrator/context_assembly_service.py 的 build_writer_system。
