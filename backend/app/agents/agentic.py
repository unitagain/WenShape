# -*- coding: utf-8 -*-
"""
文枢 WenShape - 深度上下文感知的智能体小说创作系统
WenShape - Deep Context-Aware Agent-Based Novel Writing System

Copyright © 2025-2026 WenShape Team
License: PolyForm Noncommercial License 1.0.0

模块说明 / Module Description:
  通用 agentic 工具循环（Phase 3）—— "LLM 在循环里自主调用工具"
  (Anthropic: agents = LLMs autonomously using tools in a loop)。

  注意 / Note:
  消息回放对 OpenAI 兼容 provider 用 `assistant.tool_calls` + `role="tool"`；
  对 Anthropic 用 `tool_use` / `tool_result` 内容块（Phase 5 已适配，按首个响应的 provider 判定）。
  thinking（若 provider 返回）经 on_event 以 {"type":"thinking"} 透传，供透明化展示。
"""

from typing import Any, Awaitable, Callable, Dict, List, Optional
import asyncio
import json
import re
import time

from app.utils.logger import get_logger
from app.error_contract import DomainError, error_envelope, record_degradation, tool_error_text
from app.agents.runtime_result import AgentRunResult, AgentRunStatus
from app.context_engine.tool_artifact import (
    ToolArtifactStore,
    ToolExecutionResult,
    ToolExecutionStatus,
    output_sha256,
    safe_output_preview,
)
from app.context_engine.turn_scope import current_turn_scope

logger = get_logger(__name__)

OnEvent = Optional[Callable[[Dict[str, Any]], Awaitable[None]]]


def _parse_tool_args(arguments: Any) -> Dict[str, Any]:
    """把工具参数（JSON 字符串或 dict）解析为 dict，供 Anthropic tool_use.input 用。"""
    if isinstance(arguments, dict):
        return arguments
    try:
        data = json.loads(arguments or "{}")
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def _argument_fingerprint(arguments: Any) -> str:
    """
    生成与「参数写法」无关、只与「参数取值」有关的稳定指纹。

    Stable fingerprint that depends on argument *values*, not on their serialization.

    同一批参数可能以 dict 或 JSON 字符串到达，键序也可能不同；直接对原始形态取哈希
    会把等价调用误判为不同调用，使重复检测漏报。
    """
    parsed = _parse_tool_args(arguments)
    try:
        return json.dumps(parsed, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    except (TypeError, ValueError):
        # 参数含不可序列化对象时退化为原始形态：宁可漏报，不可误报。
        return str(arguments or "")


def _partial_json_string(arguments: str, key: str) -> str:
    """Decode a complete or in-progress JSON string field for provisional streaming."""
    match = re.search(rf'"{re.escape(key)}"\s*:\s*"', str(arguments or ""))
    if not match:
        return ""
    raw: List[str] = []
    escaped = False
    for char in str(arguments)[match.end() :]:
        if escaped:
            raw.extend(("\\", char))
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if char == '"':
            break
        raw.append(char)
    if escaped:
        raw.append("\\")
    candidate = "".join(raw)
    try:
        return str(json.loads(f'"{candidate}"'))
    except json.JSONDecodeError:
        return candidate.replace("\\n", "\n").replace('\\"', '"').replace("\\\\", "\\")


async def _emit(on_event: OnEvent, event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not on_event:
        return None
    try:
        await on_event(event)
    except Exception as exc:
        code = record_degradation("agentic_event_callback", exc)
        return {"type": "event_callback_failure", "code": code, "event_type": str(event.get("type") or "")}
    return None


def _tool_error_code(output: str) -> str:
    match = re.search(r"\bcode=([^\s\]]+)", str(output or ""))
    return str(match.group(1) if match else "tool_execution_failed")


_DEFAULT_TOOL_RESULT_BUDGET = 8000  # compatibility-only; gateway accounting owns runtime folding
_REASONING_BLOCK_RE = re.compile(
    r"<(?P<tag>think|thinking|analysis)>\s*(?P<body>.*?)\s*</(?P=tag)>",
    re.IGNORECASE | re.DOTALL,
)


def _split_reasoning_text(value: Any) -> tuple[str, str]:
    """Split common tagged reasoning from user-visible assistant text."""

    text = str(value or "")
    reasoning = [match.group("body").strip() for match in _REASONING_BLOCK_RE.finditer(text)]
    visible = _REASONING_BLOCK_RE.sub("", text).strip()
    if not reasoning:
        open_tag = re.match(r"^<(think|thinking|analysis)>\s*(.*)$", text, re.IGNORECASE | re.DOTALL)
        if open_tag:
            return open_tag.group(2).strip(), ""
    return "\n\n".join(part for part in reasoning if part), visible


async def run_agentic_chat(
    gateway,
    provider: str,
    messages: List[Dict[str, Any]],
    toolset,
    *,
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
    max_iterations: int = 4,
    thinking: Optional[Any] = None,
    on_event: OnEvent = None,
    # DEPRECATED（保留仅为调用方签名兼容，值被忽略）：tool result 预算现由
    # ``token_accounting.fold_payload_to_budget`` 统一负责，gateway 是唯一 folding owner。
    # 新代码不要传这个参数；下次触及本函数签名时可直接删除。
    tool_result_budget: int = _DEFAULT_TOOL_RESULT_BUDGET,
    artifact_store: Optional[ToolArtifactStore] = None,
    deadline_seconds: Optional[float] = None,
    emit_reasoning: bool = True,
) -> AgentRunResult:
    """运行"LLM ↔ 工具"循环，直到模型不再请求工具或达到上限，返回最终响应 dict。

    Args:
        gateway: LLMGateway（需 Phase 2 的 tools 透传与 tool_calls 返回）。
        provider: profile id。
        messages: 初始消息（system + user）。
        toolset: 提供 .schemas() 与 async .execute(name, arguments) 的工具集。
        max_iterations: 最大 provider/tool 循环次数；达到上限返回 incomplete，不追加请求。
        thinking: 可选，透传给 gateway.chat 的 thinking 配置（默认 None=关）。
        on_event: 可选 async 回调，透传 thinking/工具调用过程（供 Phase 5 透明化复用）。
            事件形如 {"type": "thinking"|"tool_call"|"tool_result", ...}。

    Returns:
        统一的 AgentRunResult；保留 ``response.get(...)`` 风格的兼容访问。

    说明：消息回放对 OpenAI 兼容 provider 用 `assistant.tool_calls` + `role:"tool"`；
    对 Anthropic 用 `tool_use` / `tool_result` 内容块（按首个响应的 provider 判定）。
    """
    del tool_result_budget  # DEPRECATED，见签名处注释；显式丢弃以免误读为"已生效"
    started = time.monotonic()
    explicit_deadline = (
        started + float(deadline_seconds)
        if deadline_seconds is not None and float(deadline_seconds) > 0
        else None
    )
    msgs: List[Dict[str, Any]] = list(messages)
    schemas = toolset.schemas()
    scope = current_turn_scope()
    if scope is not None and scope.runtime is not None:
        runtime = scope.runtime
    else:
        from app.orchestrator.turn_runtime import TurnRuntime

        runtime = TurnRuntime(
            turn_id="agentic_local",
            timeout_seconds=max(1.0, float(deadline_seconds or 600.0)),
        )
    store = artifact_store
    if store is None and scope is not None:
        store = ToolArtifactStore(project_root=scope.source_registry.project_root if scope.source_registry else None)
    tool_results: List[ToolExecutionResult] = []
    degradations: List[Dict[str, Any]] = []
    last_response: Dict[str, Any] = {}
    iterations = 0
    # 轻量 doom loop 防护：记录 (工具名, 参数指纹) → 已调用次数。
    # 判据取「重复调用」而非「失败次数」，因为部分工具（如 edit_lines 未命中）
    # 走的是正常返回而非 tool_error，按失败计数恰好漏掉最该抓的场景；
    # 而确定性工具用同一组参数重复调用必得同一结果——重复本身即无进展。
    repeated_calls: Dict[str, int] = {}
    stream_tool_buffers: Dict[int, Dict[str, str]] = {}
    stream_provisional_lengths: Dict[int, int] = {}
    streamed_thinking = False
    commentary_emitted = False
    requires_terminal_tool = bool(getattr(toolset, "requires_terminal_tool", False))

    def finish(
        status: AgentRunStatus,
        *,
        response: Optional[Dict[str, Any]] = None,
        error: Optional[Dict[str, Any]] = None,
        reason: str = "",
    ) -> AgentRunResult:
        payload = dict(response or {})
        elapsed_ms = int((time.monotonic() - started) * 1000)
        try:
            from app.observability.usage_diagnostics import record_agent_run

            record_agent_run(
                status=status.value,
                iterations=iterations,
                tool_calls=len(tool_results),
                elapsed_ms=elapsed_ms,
            )
        except Exception as exc:
            record_degradation("agent_usage_diagnostics", exc)
        return AgentRunResult(
            status=status.value,
            content=str(payload.get("content") or ""),
            response=payload,
            tool_results=tuple(tool_results),
            error=error,
            elapsed_ms=elapsed_ms,
            iterations=iterations,
            finish_reason=reason or str(payload.get("finish_reason") or ""),
            degradations=tuple(degradations),
        )

    def envelope(exc: BaseException) -> Dict[str, Any]:
        return error_envelope(exc, trace_id=scope.trace_id if scope is not None else "").to_dict()

    def active_timeout() -> float:
        remaining = runtime.remaining_seconds
        if explicit_deadline is not None:
            remaining = min(remaining, max(0.0, explicit_deadline - time.monotonic()))
        if remaining <= 0:
            raise TimeoutError("turn_deadline_exceeded")
        return remaining

    async def provider_chat(*, tools: Optional[List[Dict[str, Any]]]) -> Dict[str, Any]:
        nonlocal streamed_thinking
        runtime.ensure_active()
        streamed_thinking = False
        stream_tool_buffers.clear()
        stream_provisional_lengths.clear()
        timeout = active_timeout()
        agentic_chat = getattr(gateway, "agentic_chat", None)
        if callable(agentic_chat):
            async def on_stream_event(event: Dict[str, Any]) -> None:
                nonlocal streamed_thinking
                event_type = str(event.get("type") or "")
                if event_type == "thinking_delta":
                    streamed_thinking = True
                    if emit_reasoning:
                        degradation = await _emit(
                            on_event,
                            {"type": "thinking", "content": str(event.get("content") or ""), "stream": True},
                        )
                        if degradation:
                            degradations.append(degradation)
                elif event_type == "content_delta":
                    degradation = await _emit(
                        on_event,
                        {
                            "type": "provisional_content",
                            "content": str(event.get("content") or ""),
                            "source": "assistant",
                        },
                    )
                    if degradation:
                        degradations.append(degradation)
                elif event_type == "tool_call_delta":
                    index = int(event.get("index") or 0)
                    buffer = stream_tool_buffers.setdefault(index, {"name": "", "arguments": ""})
                    buffer["name"] += str(event.get("name") or "")
                    buffer["arguments"] += str(event.get("arguments") or "")
                    field = "content" if buffer["name"] == "write_content" else "new_text"
                    if buffer["name"] in {"write_content", "edit_lines"}:
                        current = _partial_json_string(buffer["arguments"], field)
                        previous = stream_provisional_lengths.get(index, 0)
                        if len(current) > previous:
                            stream_provisional_lengths[index] = len(current)
                            degradation = await _emit(
                                on_event,
                                {
                                    "type": "provisional_content",
                                    "content": current[previous:],
                                    "source": "tool_argument",
                                    "tool": buffer["name"],
                                },
                            )
                            if degradation:
                                degradations.append(degradation)
                elif event_type == "stream_degradation":
                    degradations.append(dict(event))

            return await runtime.wait_for(
                agentic_chat(
                    msgs,
                    provider=provider,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    tools=tools,
                    thinking=thinking,
                    timeout_seconds=timeout,
                    on_stream_event=on_stream_event,
                ),
                timeout_seconds=timeout,
            )
        return await runtime.wait_for(
            gateway.chat(
                msgs,
                provider=provider,
                temperature=temperature,
                max_tokens=max_tokens,
                tools=tools,
                thinking=thinking,
                timeout_seconds=timeout,
            ),
            timeout_seconds=timeout,
        )

    if scope is not None and scope.source_closure_required:
        scope.register_source_content(
            source_id="procedural.writer_tool_schemas",
            asset_type="procedural_knowledge",
            content=schemas,
            selection_reason="agentic_tool_contract",
            artifact_ref=f"{toolset.__class__.__module__}.{toolset.__class__.__name__}.schemas",
        )
        scope.register_provider_payload(
            [],
            schemas,
            source_prefix="agentic.tools",
            selection_reason="agentic_tool_schema_assembly",
            artifact_ref="run_agentic_chat:schemas",
        )

    # 预算只计「实质轮次」：协议性催促（模型该收尾却没调 finish_turn）不扣预算。
    # 那类往返是合同开销、不是工作进展；让它吃掉预算会把「差一步就完成」直接推成 incomplete
    # （plan.md §10.3 V2-3 的 6 轮推演即为此场景）。仍设总轮次硬上限防止无限循环。
    budget = max(1, max_iterations)
    spent = 0
    hard_limit = budget * 2 + 4
    turns = 0
    while spent < budget and turns < hard_limit:
        turns += 1
        try:
            resp = await provider_chat(tools=schemas)
        except asyncio.CancelledError:
            raise
        except RuntimeError as exc:
            error_payload = envelope(exc)
            if str(exc) == "turn_cancelled":
                return finish(AgentRunStatus.CANCELLED, error=error_payload, reason="turn_cancelled")
            return finish(AgentRunStatus.FAILED, error=error_payload, reason="provider_failure")
        except TimeoutError as exc:
            error_payload = envelope(exc)
            return finish(AgentRunStatus.FAILED, error=error_payload, reason="turn_deadline_exceeded")
        except Exception as exc:
            error_payload = envelope(exc)
            return finish(AgentRunStatus.FAILED, error=error_payload, reason="provider_failure")
        iterations += 1
        spent += 1
        last_response = dict(resp or {})
        is_anthropic = str(resp.get("provider") or "").lower() == "anthropic"

        thought = str(resp.get("thinking") or "").strip()
        tagged_thought, visible_content = _split_reasoning_text(resp.get("content"))
        if emit_reasoning and thought and not streamed_thinking:
            degradation = await _emit(on_event, {"type": "thinking", "content": thought})
            if degradation:
                degradations.append(degradation)
        if emit_reasoning and tagged_thought and tagged_thought != thought:
            degradation = await _emit(on_event, {"type": "thinking", "content": tagged_thought})
            if degradation:
                degradations.append(degradation)

        tool_calls = resp.get("tool_calls")
        # 工具循环旁白只保留本轮第一条有价值的用户可见更新；后续动作由工具轨迹表达，
        # 避免「开始写入 / 已写完 / 提交收尾」逐轮堆叠成伪思考日志。
        commentary = visible_content
        if commentary and tool_calls and not commentary_emitted:
            commentary_emitted = True
            degradation = await _emit(on_event, {"type": "assistant_text", "content": commentary})
            if degradation:
                degradations.append(degradation)

        if not tool_calls:
            if requires_terminal_tool and not bool(getattr(toolset, "has_terminal_payload", False)):
                assistant_text = str(resp.get("content") or "").strip()
                if assistant_text:
                    msgs.append({"role": "assistant", "content": assistant_text})
                msgs.append(
                    {
                        "role": "user",
                        "content": "请不要继续解释；现在必须调用 finish_turn 提交本轮变化类型、摘要和事实候选。",
                    }
                )
                # 退回本轮预算：这是协议性催促，不是工作进展（见循环入口注释）。
                # 由 hard_limit 兜底，模型若反复不收尾仍会终止而非空转。
                spent -= 1
                continue
            visible_response = dict(resp or {})
            visible_response["content"] = visible_content
            return finish(AgentRunStatus.COMPLETED, response=visible_response)

        # 回放 assistant 的工具调用消息（按 provider 选择格式）
        if is_anthropic:
            content_blocks: List[Dict[str, Any]] = []
            if resp.get("content"):
                content_blocks.append({"type": "text", "text": resp.get("content")})
            for tc in tool_calls:
                content_blocks.append(
                    {
                        "type": "tool_use",
                        "id": tc.get("id"),
                        "name": tc.get("name"),
                        "input": _parse_tool_args(tc.get("arguments")),
                    }
                )
            assistant_message = {"role": "assistant", "content": content_blocks}
            msgs.append(assistant_message)
        else:
            assistant_message = {
                "role": "assistant",
                "content": resp.get("content") or "",
                "tool_calls": [
                    {
                        "id": tc.get("id"),
                        "type": "function",
                        "function": {"name": tc.get("name"), "arguments": tc.get("arguments") or "{}"},
                    }
                    for tc in tool_calls
                ],
            }
            msgs.append(assistant_message)
        if scope is not None and scope.source_closure_required:
            scope.register_source_content(
                source_id=f"provider.response.{len(msgs) - 1}",
                asset_type="provider_response",
                content=assistant_message,
                selection_reason="agentic_tool_call_replay",
                artifact_ref="provider_response:tool_calls",
            )
            scope.register_provider_payload(
                [assistant_message],
                source_prefix="agentic.assistant",
                selection_reason="agentic_tool_call_replay",
                artifact_ref="run_agentic_chat:assistant_replay",
            )

        # 输入请求工具主导整个 provider batch：即便模型把写作调用排在反问前，
        # 也先执行反问并立即暂停，避免并行工具排序造成正文副作用。
        execution_tool_calls = list(tool_calls)
        input_tool_checker = getattr(toolset, "is_input_tool", None)
        if callable(input_tool_checker):
            input_calls = [tc for tc in execution_tool_calls if input_tool_checker(str(tc.get("name") or ""))]
            if input_calls:
                execution_tool_calls = input_calls + [
                    tc for tc in execution_tool_calls if not input_tool_checker(str(tc.get("name") or ""))
                ]

        # 执行工具并回灌结果（Anthropic 用单条 user 消息聚合 tool_result 块）
        anthropic_results: List[Dict[str, Any]] = []
        repeat_notices: List[tuple] = []
        terminal_tool_called = False
        input_required_payload: Optional[Dict[str, Any]] = None
        for tc in execution_tool_calls:
            name = str(tc.get("name") or "")
            tool_call_id = str(tc.get("id") or "")
            arguments = tc.get("arguments")
            terminal_checker = getattr(toolset, "is_terminal_tool", None)
            try:
                from app.observability.usage_diagnostics import record_tool_call

                record_tool_call(name)
            except Exception as exc:
                record_degradation("agent_tool_usage_diagnostics", exc)
            try:
                runtime.ensure_active()
            except RuntimeError as exc:
                error_payload = envelope(exc)
                return finish(AgentRunStatus.CANCELLED, response=resp, error=error_payload, reason="turn_cancelled")
            except TimeoutError as exc:
                error_payload = envelope(exc)
                return finish(
                    AgentRunStatus.FAILED,
                    response=resp,
                    error=error_payload,
                    reason="turn_deadline_exceeded",
                )
            degradation = await _emit(
                on_event,
                {"type": "tool_call", "tool_call_id": tool_call_id, "name": name, "arguments": arguments},
            )
            if degradation:
                degradations.append(degradation)

            tool_started = time.monotonic()
            tool_error: Optional[Dict[str, Any]] = None
            try:
                tool_timeout = active_timeout()
                raw_result = await runtime.wait_for(
                    toolset.execute(name, arguments),
                    timeout_seconds=tool_timeout,
                )
                runtime.ensure_active()
                output = str(raw_result or "")
                status = (
                    ToolExecutionStatus.FAILED.value
                    if output.startswith("[tool_error ")
                    else ToolExecutionStatus.SUCCEEDED.value
                )
                if status == ToolExecutionStatus.FAILED.value:
                    tool_error = error_envelope(
                        DomainError(code=_tool_error_code(output), degraded=True),
                        trace_id=scope.trace_id if scope is not None else "",
                        degraded=True,
                    ).to_dict()
                elif callable(terminal_checker) and terminal_checker(name):
                    # A rejected finish_turn is a normal tool error, not a
                    # terminal success. Only stop the loop after the tool has
                    # produced a terminal payload that can be committed.
                    terminal_tool_called = bool(getattr(toolset, "has_terminal_payload", False))
            except asyncio.CancelledError:
                raise
            except RuntimeError as exc:
                if str(exc) != "turn_cancelled":
                    output = tool_error_text(name, exc)
                    status = ToolExecutionStatus.FAILED.value
                    tool_error = envelope(exc)
                else:
                    cancelled_result = ToolExecutionResult(
                        tool_call_id=tool_call_id,
                        tool_name=name,
                        status=ToolExecutionStatus.CANCELLED.value,
                        output_preview="",
                        artifact_ref="",
                        output_hash="",
                        error=envelope(exc),
                        elapsed_ms=int((time.monotonic() - tool_started) * 1000),
                        recoverable=False,
                    )
                    tool_results.append(cancelled_result)
                    return finish(AgentRunStatus.CANCELLED, response=resp, error=cancelled_result.error, reason="turn_cancelled")
            except TimeoutError as exc:
                timed_out = ToolExecutionResult(
                    tool_call_id=tool_call_id,
                    tool_name=name,
                    status=ToolExecutionStatus.TIMED_OUT.value,
                    output_preview="",
                    artifact_ref="",
                    output_hash="",
                    error=envelope(exc),
                    elapsed_ms=int((time.monotonic() - tool_started) * 1000),
                    recoverable=False,
                )
                tool_results.append(timed_out)
                return finish(AgentRunStatus.FAILED, response=resp, error=timed_out.error, reason="turn_deadline_exceeded")
            except Exception as exc:
                output = tool_error_text(name, exc)
                status = ToolExecutionStatus.FAILED.value
                tool_error = envelope(exc)

            # 重复调用检测：同一 (工具, 参数) 第 2 次起，提示模型换策略。
            # 提示**不写进 output**——工具输出要原样进入 artifact 与哈希，
            # 折叠由 gateway 单独负责（见 test_agentic_metabolism 冻结的契约）；
            # 这里只记录，稍后作为独立消息回灌，避免污染工具结果本身。
            repeat_key = f"{name}:{output_sha256(_argument_fingerprint(arguments))}"
            repeat_count = repeated_calls.get(repeat_key, 0) + 1
            repeated_calls[repeat_key] = repeat_count
            if repeat_count >= 2:
                repeat_notices.append((name, repeat_count))

            output_hash = output_sha256(output)
            artifact_ref = ""
            if store is not None:
                try:
                    runtime.ensure_active()
                    artifact = store.persist(
                        output,
                        turn_id=scope.turn_id if scope is not None else runtime.turn_id,
                        tool_call_id=tool_call_id,
                        tool_name=name,
                        status=status,
                        project_id=scope.project_id if scope is not None else "",
                    )
                    artifact_ref = artifact.artifact_ref
                    output_hash = artifact.output_hash
                except (OSError, UnicodeError, TypeError, ValueError) as exc:
                    code = record_degradation("tool_artifact_persist", exc)
                    degradations.append({"type": "tool_artifact_failure", "code": code, "tool_call_id": tool_call_id})
            recoverability = getattr(toolset, "is_result_recoverable", None)
            declared_recoverable = bool(recoverability(name)) if callable(recoverability) else False
            recoverable = bool(
                declared_recoverable and artifact_ref and status == ToolExecutionStatus.SUCCEEDED.value
            )
            preview = safe_output_preview(output, artifact_ref=artifact_ref)
            execution = ToolExecutionResult(
                tool_call_id=tool_call_id,
                tool_name=name,
                status=status,
                output_preview=preview,
                artifact_ref=artifact_ref,
                output_hash=output_hash,
                error=tool_error,
                elapsed_ms=int((time.monotonic() - tool_started) * 1000),
                recoverable=recoverable,
            )
            tool_results.append(execution)
            metadata = execution.replay_metadata()
            if is_anthropic:
                anthropic_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_call_id,
                        "content": preview,
                        **metadata,
                    }
                )
            else:
                tool_message = {
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "content": preview,
                    **metadata,
                }
                msgs.append(tool_message)
                if scope is not None and scope.source_closure_required:
                    scope.register_provider_payload(
                        [tool_message],
                        source_prefix="agentic.tool_result",
                        selection_reason="agentic_tool_result_replay",
                        artifact_ref=artifact_ref,
                    )
            degradation = await _emit(
                on_event,
                {
                    "type": "tool_result",
                    "tool_call_id": tool_call_id,
                    "name": name,
                    "arguments": arguments,
                    "result": preview,
                    "tool_result": execution.to_dict(),
                },
            )
            if degradation:
                degradations.append(degradation)

            # An input-capable tool may pause the turn and require author input.
            # Stop executing the rest of a provider batch immediately so a
            # speculative write/finish call cannot slip through after the pause.
            pause_builder = getattr(toolset, "input_required_payload", None)
            if callable(pause_builder):
                try:
                    candidate = pause_builder()
                except Exception as exc:
                    record_degradation("agent_input_required_payload", exc)
                    candidate = None
                if isinstance(candidate, dict) and candidate.get("questions"):
                    input_required_payload = dict(candidate)
                    break

        if is_anthropic and anthropic_results:
            tool_message = {"role": "user", "content": anthropic_results}
            msgs.append(tool_message)
            if scope is not None and scope.source_closure_required:
                scope.register_provider_payload(
                    [tool_message],
                    source_prefix="agentic.tool_result",
                    selection_reason="agentic_tool_result_replay",
                    artifact_ref=str(anthropic_results[-1].get("_source_ref") or ""),
                )

        # 重复调用提示：作为独立 user 消息回灌，不混入工具结果（保持 tool 输出可原样折叠/哈希）。
        # 只提示、不中断——先把换策略的机会交还模型，保留其自主性；是否升级为主动终止
        # 待观测数据支持后再议。终态语义不变，不新增第五态。
        if repeat_notices:
            notice_lines = [
                f"- {tool_name}：已用完全相同的参数调用 {count} 次，结果不会改变。"
                for tool_name, count in repeat_notices
            ]
            notice_message = {
                "role": "user",
                "content": (
                    "[repeated_call] 检测到重复调用：\n"
                    + "\n".join(notice_lines)
                    + "\n请换一种做法：换用其他工具、调整参数，或调用 finish_turn 说明当前进展与卡点。"
                ),
            }
            msgs.append(notice_message)
            if scope is not None and scope.source_closure_required:
                scope.register_provider_payload(
                    [notice_message],
                    source_prefix="agentic.repeat_notice",
                    selection_reason="agentic_repeated_call_nudge",
                    artifact_ref="run_agentic_chat:repeat_notice",
                )
            repeat_notices.clear()

        if input_required_payload is not None:
            clarification_response = dict(resp or {})
            clarification_response.update(
                {
                    "terminal_state": "requires_input",
                    "reason": "clarification_requested",
                    "clarification": input_required_payload,
                    "questions": list(input_required_payload.get("questions") or []),
                }
            )
            clarification_response["content"] = ""
            return finish(
                AgentRunStatus.INCOMPLETE,
                response=clarification_response,
                reason="clarification_requested",
            )

        if terminal_tool_called:
            payload_builder = getattr(toolset, "terminal_payload", None)
            terminal_payload = dict(payload_builder() or {}) if callable(payload_builder) else {}
            terminal_response = dict(resp or {})
            terminal_response["terminal_payload"] = terminal_payload
            terminal_response["content"] = str(terminal_payload.get("message") or resp.get("content") or "")
            return finish(
                AgentRunStatus.COMPLETED,
                response=terminal_response,
                reason="terminal_tool",
            )

    # 区分两种耗尽：预算用完（正常上限）vs 硬上限（模型反复不收尾，协议性空转）。
    # 二者都是 incomplete——不把「没做完」伪装成 completed（§4 不变量）——但 reason 不同，
    # 便于诊断到底是活儿太多还是模型不遵守收尾合同。
    exhausted_reason = "max_iterations" if spent >= budget else "terminal_tool_never_called"
    logger.info(
        "agentic loop exhausted: reason=%s budget=%d spent=%d turns=%d",
        exhausted_reason,
        budget,
        spent,
        turns,
    )
    return finish(AgentRunStatus.INCOMPLETE, response=last_response, reason=exhausted_reason)
