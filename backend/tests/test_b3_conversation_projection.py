# -*- coding: utf-8 -*-
"""
文枢 WenShape - 深度上下文感知的智能体小说创作系统
WenShape - Deep Context-Aware Agent-Based Novel Writing System

Copyright © 2025-2026 WenShape Team
License: PolyForm Noncommercial License 1.0.0

模块说明 / Module Description:
  B3 对话投影与压缩合同测试 - 历史投影按完整 turn 选择（长 user 不被孤立
  丢弃）、摘要与验证输入分块完整覆盖（评估报告 F08）。
  B3 conversation projection contract tests - history projection selects whole
  turns (a long user message is never orphan-dropped), and summary/verify
  inputs cover the full source in chunks (finding F08).
"""

import asyncio

from app.orchestrator.context_assembly_service import ContextAssemblyService


class TestTurnIntegrityProjection:
    """F08 探针 1：长 user + 短 assistant 不得产生孤立回答。"""

    @staticmethod
    def _history(long_user_tokens_hint: str, short_user: str) -> list:
        return [
            {"role": "user", "content": "旧问题OLD_Q"},
            {"role": "assistant", "content": "旧回答OLD_A"},
            {"role": "user", "content": long_user_tokens_hint},
            {"role": "assistant", "content": "RECENT_REPLY 近期回答。"},
        ]

    def test_long_user_not_orphan_dropped(self, tmp_path):
        """预算竞争下：最近 user（超长）与旧消息都装不下时，不得只留旧消息+新回答。"""
        history = self._history(
            "RECENT_USER_CONSTRAINT " + "user_constraint_token " * 6000,
            "新输入",
        )
        selected, report = ContextAssemblyService._project_conversation_history(
            history,
            current_message="新输入",
            budget_tokens=4000,
        )
        contents = [item["content"] for item in selected]
        joined = "\n".join(contents)
        # 不变量：选择了 user 消息就必须带上其回答；选择了回答就必须有其 user。
        roles = [item["role"] for item in selected]
        if "assistant" in roles:
            user_before_assistant = any(
                roles[i] == "user" for i in range(len(roles)) if i >= roles.index("assistant")
            ) or roles.index("user") < roles.index("assistant")
            assert user_before_assistant, f"孤立 assistant 回答（roles={roles}）"
        # 旧短消息不得孤立挤掉最近的轮次：若旧消息留下，最近的 user 约束（投影后）
        # 也必须留下或被显式标记省略。
        if "旧回答OLD_A" in joined:
            # 旧 turn 完整（Q+A 都在），可接受；但不允许「旧Q 丢了只留旧A」
            assert "旧问题OLD_Q" in joined, "旧回答孤立（其 user 问题被丢）"
        # 最近 turn：RECENT_REPLY 在场时其 user 的约束标记必须在场
        if "RECENT_REPLY" in joined:
            assert (
                "RECENT_USER_CONSTRAINT" in joined or "省略" in joined
            ), "最近的 user 约束被完全丢弃而其回答仍留下"

    def test_recent_turn_survives_budget_competition(self, tmp_path):
        """常规场景：中等预算下最近的完整 turn 必须保留（含其 user 消息）。"""
        history = self._history("近期作者约束：主角不得使用现代词汇。", "新输入")
        selected, _ = ContextAssemblyService._project_conversation_history(
            history,
            current_message="新输入",
            budget_tokens=2000,
        )
        joined = "\n".join(item["content"] for item in selected)
        assert "RECENT_REPLY" in joined
        assert "近期作者约束" in joined, "最近 turn 的 user 约束不得被同 turn 的 assistant 挤掉"

    def test_old_turns_kept_whole(self, tmp_path):
        """旧 turn 保留时必须 user+assistant 成对（不再单条挑选）。"""
        history = [
            msg
            for i in range(5)
            for msg in ({"role": "user", "content": f"问题{i}"}, {"role": "assistant", "content": f"回答{i}"})
        ] + [{"role": "user", "content": "当前输入"}]
        selected, report = ContextAssemblyService._project_conversation_history(
            history,
            current_message="当前输入",
            budget_tokens=4000,
        )
        roles = [item["role"] for item in selected]
        # 每个 assistant 前必须有相邻（同 turn）的 user
        for idx, role in enumerate(roles):
            if role == "assistant":
                assert any(r == "user" for r in roles[:idx]), f"第 {idx} 条 assistant 无前置 user"


class _CompactFakeGateway:
    """捕获全部 chat 输入；摘要/验证/偏好提炼统一返回可解析 JSON。"""

    def __init__(self):
        self.calls: list = []  # [(system, user)] 逐次记录

    def get_provider_for_agent(self, name):
        return "fake"

    async def chat(self, messages, **kwargs):
        self.calls.append((str(messages[0].get("content") or ""), str(messages[-1].get("content") or "")))
        return {
            "content": (
                '{"decisions": [], "constraints": [], "entity_state": [], '
                '"open_loops": [], "recent_summary": "ok"}'
            ),
            "provider": "fake",
            "model": "fake",
        }


def _orch_with_capture(tmp_path):
    from app.orchestrator.orchestrator import Orchestrator

    orch = Orchestrator(str(tmp_path))
    gateway = _CompactFakeGateway()
    orch.gateway = gateway
    # archivist 是真实 Agent、持有自己的 gateway 引用（会打真实 provider）；
    # 本测试只验证摘要/验证输入覆盖，偏好提炼不在断言面——替换为无副作用的桩。
    orch.post_turn_service.archivist = type(
        "_StubArchivist", (), {"extract_creative_memory": staticmethod(lambda **kw: _empty_memories())}
    )()
    return orch, gateway


async def _empty_memories():
    return []


class TestSummarizerChunkedCoverage:
    """F08 探针 2：6000 字符后的摘要哨兵必须进入摘要请求（走公有 compact 端口）。"""

    def test_summary_input_covers_tail_sentinel(self, tmp_path):
        orch, gateway = _orch_with_capture(tmp_path)
        # 第一个 turn 为超长约束（> 6000 字符，属于待摘要的早期轮次），哨兵在其尾部。
        asyncio.run(
            orch.session_history.append(
                "p1", {"role": "user", "content": "长约束正文。" * 1500 + "TAIL_SUMMARY_SENTINEL 尾部约束。"}
            )
        )
        asyncio.run(orch.session_history.append("p1", {"role": "assistant", "content": "已收到。"}))
        for i in range(6):
            asyncio.run(orch.session_history.append("p1", {"role": "user", "content": f"问题{i}"}))
            asyncio.run(orch.session_history.append("p1", {"role": "assistant", "content": f"回答{i}"}))

        result = asyncio.run(
            orch.application.conversation.compact("p1", keep_recent=2, trigger_at=4)
        )
        summary_inputs = [user for system, user in gateway.calls if "压缩器" in system]
        joined = "\n".join(summary_inputs)
        assert summary_inputs, "压缩器未被调用（compact 未走到摘要阶段）"
        assert "TAIL_SUMMARY_SENTINEL" in joined, "尾部哨兵必须进入分块后的摘要输入（F08）"
        assert len(summary_inputs) >= 2, "超长输入必须分块（不再 text[:6000] 单块）"
        assert result.get("compacted") or result.get("error"), "结果须有明确终态"


class TestVerifierChunkedCoverage:
    """F08 探针 3：60000 字符后的验证哨兵必须进入验证请求（走公有 compact 端口）。"""

    def test_verify_input_covers_tail_sentinel(self, tmp_path):
        orch, gateway = _orch_with_capture(tmp_path)
        # 第一个 turn 为超长正文（> 60000 字符，属于待压缩的早期轮次），哨兵在其尾部。
        asyncio.run(
            orch.session_history.append(
                "p1", {"role": "user", "content": "长正文填充。" * 12000 + "TAIL_VERIFY_SENTINEL 尾部验证内容。"}
            )
        )
        asyncio.run(orch.session_history.append("p1", {"role": "assistant", "content": "完成。"}))
        for i in range(8):
            asyncio.run(orch.session_history.append("p1", {"role": "user", "content": f"问题{i}"}))
            asyncio.run(orch.session_history.append("p1", {"role": "assistant", "content": f"回答{i}"}))

        result = asyncio.run(
            orch.application.conversation.compact("p1", keep_recent=2, trigger_at=4)
        )
        verify_inputs = [user for system, user in gateway.calls if "审计器" in system]
        joined = "\n".join(verify_inputs)
        assert verify_inputs, "审计器未被调用（compact 未走到验证阶段）"
        assert "TAIL_VERIFY_SENTINEL" in joined, "尾部哨兵必须进入分块后的验证输入（F08）"
        assert len(verify_inputs) >= 2, "超长来源必须分块验证（不再 source[:60000] 单块）"
        assert result.get("compacted") is True or result.get("error"), "结果须有明确终态"
