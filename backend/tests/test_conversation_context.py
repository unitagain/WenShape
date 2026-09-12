from app.orchestrator.context_assembly_service import ContextAssemblyService


def test_history_projection_keeps_summary_and_recent_dialogue_without_ui_system_noise():
    messages, report = ContextAssemblyService._project_conversation_history(
        [
            {"role": "system", "type": "summary", "content": "作者决定林舟留在新城。"},
            {"role": "system", "type": "error", "content": "连接失败"},
            {"role": "user", "content": "上一轮怎么安排？"},
            {"role": "assistant", "content": "林舟会留在新城。"},
        ],
        current_message="继续",
        budget_tokens=4000,
    )

    assert [item["role"] for item in messages] == ["user", "user", "assistant"]
    assert "此前对话摘要" in messages[0]["content"]
    assert "连接失败" not in " ".join(item["content"] for item in messages)
    assert report["omitted_count"] == 0


def test_history_projection_drops_current_message_written_by_racing_ui_append():
    messages, _ = ContextAssemblyService._project_conversation_history(
        [
            {"role": "user", "content": "上一轮"},
            {"role": "assistant", "content": "已处理。"},
            {"role": "user", "content": "继续"},
        ],
        current_message="继续",
        budget_tokens=4000,
    )

    assert [item["content"] for item in messages] == ["上一轮", "已处理。"]


def test_history_projection_respects_budget_and_projects_large_messages():
    messages, report = ContextAssemblyService._project_conversation_history(
        [{"role": "assistant", "content": "很长的上下文。" * 5000}],
        current_message="新问题",
        budget_tokens=500,
    )

    assert messages
    assert report["projected_count"] == 1
    assert "按 token 预算省略" in messages[0]["content"]
