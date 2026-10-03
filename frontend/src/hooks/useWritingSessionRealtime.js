import { useEffect } from 'react';
import { createWebSocket } from '../api';
import { getStreamingPreference } from '../components/ide/TitleBar';
import { isKnownBaseline, readBaseline, seedBaseline } from '../lib/chapterBaseline';
import { countWords } from '../utils/writingSessionHelpers';

// 事件入口只做「解析」，不做「摘要」：工具参数/结果保持结构化交给渲染层分层展示。
// 在此压成字符串会让下游无从区分状态、耗时与参数（U5 · plan.md §9.2.1）。
function _parseArgs(args) {
  if (args && typeof args === 'object') return args;
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_e) {
      return {};
    }
  }
  return {};
}

/**
 * 管理写作会话的实时连接。
 * Manage the realtime writing-session websocket and trace channel.
 */
export function useWritingSessionRealtime({
  projectId,
  noChapterKey,
  addMessage,
  appendProgressEvent,
  clearDiffReview,
  dispatch,
  pushNotice,
  serverStreamActiveRef,
  serverStreamUsedRef,
  setAgentTraces,
  setIsGenerating,
  setManualContent,
  setManualContentByChapter,
  setStatus,
  setStreamingState,
  setTraceEvents,
  stopStreaming,
  streamBufferByChapterRef,
  streamFlushRafByChapterRef,
  streamingChapterKeyRef,
  streamTextByChapterRef,
  t,
  traceWsRef,
  wsRef,
  wsStatusRef,
  activeChapterKeyRef,
  lastGeneratedByChapterRef,
  writingLanguage,
  streamOriginalByChapterRef,
  onStreamFinalize,
  onInputRequired,
}) {
  useEffect(() => {
    if (!projectId) return;
    let disposed = false;

    const wsController = createWebSocket(
      projectId,
      (data) => {
        if (disposed || (data?.project_id && String(data.project_id) !== String(projectId))) return;
        const wsChapterKey = data?.chapter ? String(data.chapter) : noChapterKey;
        if (data.type === 'start_ack') {
          appendProgressEvent({ stage: 'session_start', message: t('writingSession.sessionStarted') }, wsChapterKey);
        }
        if (data.type === 'stream_start') {
          streamingChapterKeyRef.current = wsChapterKey;
          stopStreaming();
          clearDiffReview();
          serverStreamActiveRef.current = true;
          serverStreamUsedRef.current = true;
          streamBufferByChapterRef.current[wsChapterKey] = '';
          streamTextByChapterRef.current[wsChapterKey] = '';
          if (streamFlushRafByChapterRef.current[wsChapterKey]) {
            window.cancelAnimationFrame(streamFlushRafByChapterRef.current[wsChapterKey]);
            streamFlushRafByChapterRef.current[wsChapterKey] = null;
          }
          lastGeneratedByChapterRef.current[wsChapterKey] = true;
          setManualContentByChapter((prev) => {
            // 基线只在「本会话确实加载过这一章」时才成立。未加载过的章节（AI 直接写
            // 一个没打开过的章节）拿不到原文，此时绝不能把基线伪造成空串——那会让
            // 流式失败后的还原、以及后续的 diff 基线全部退化成「原文为空」。
            const seeded = seedBaseline(streamOriginalByChapterRef?.current, wsChapterKey, prev?.[wsChapterKey]);
            const next = { ...(prev || {}) };
            if (seeded) {
              // 基线已知 → 置空供流式逐 token 填充，中断时可原样还原。
              next[wsChapterKey] = '';
            } else {
              // 基线未知 → 保持未知（移除条目），由服务端加载真实正文，
              // 而不是留下一个会被当成权威原文的空串。
              delete next[wsChapterKey];
            }
            return next;
          });
          if (activeChapterKeyRef.current === wsChapterKey) {
            setManualContent('');
          }
          setIsGenerating(true);
          setStreamingState({
            active: true,
            progress: 0,
            current: 0,
            total: data.total || 0,
          });
        }
        if (data.type === 'token' && typeof data.content === 'string') {
          if (!serverStreamActiveRef.current) {
            return;
          }
          streamBufferByChapterRef.current[wsChapterKey] =
            (streamBufferByChapterRef.current[wsChapterKey] || '') + data.content;
          // 直接输出模式下仅缓存 token，不逐帧刷新 UI。
          // In direct output mode we buffer tokens without per-frame UI updates.
          if (!getStreamingPreference()) {
            const buffered = streamBufferByChapterRef.current[wsChapterKey] || '';
            const nextText = (streamTextByChapterRef.current[wsChapterKey] || '') + buffered;
            streamTextByChapterRef.current[wsChapterKey] = nextText;
            streamBufferByChapterRef.current[wsChapterKey] = '';
            return;
          }
          if (!streamFlushRafByChapterRef.current[wsChapterKey]) {
            streamFlushRafByChapterRef.current[wsChapterKey] = window.requestAnimationFrame(() => {
              const buffered = streamBufferByChapterRef.current[wsChapterKey] || '';
              const nextText = (streamTextByChapterRef.current[wsChapterKey] || '') + buffered;
              streamTextByChapterRef.current[wsChapterKey] = nextText;
              streamBufferByChapterRef.current[wsChapterKey] = '';
              setManualContentByChapter((prev) => ({ ...(prev || {}), [wsChapterKey]: nextText }));
              if (activeChapterKeyRef.current === wsChapterKey) {
                setManualContent(nextText);
              }
              const current = nextText.length;
              setStreamingState((prev) => ({
                ...prev,
                current,
                progress: prev.total ? Math.round((current / prev.total) * 100) : prev.progress,
              }));
              streamFlushRafByChapterRef.current[wsChapterKey] = null;
            });
          }
        }
        if (data.type === 'stream_end') {
          if (streamFlushRafByChapterRef.current[wsChapterKey]) {
            window.cancelAnimationFrame(streamFlushRafByChapterRef.current[wsChapterKey]);
            streamFlushRafByChapterRef.current[wsChapterKey] = null;
          }
          const buffered = streamBufferByChapterRef.current[wsChapterKey] || '';
          const combined = (streamTextByChapterRef.current[wsChapterKey] || '') + buffered;
          streamTextByChapterRef.current[wsChapterKey] = combined;
          streamBufferByChapterRef.current[wsChapterKey] = '';
          const finalText = data.draft?.content || combined;
          serverStreamActiveRef.current = false;
          streamingChapterKeyRef.current = null;
          // 生成结束 → 落为 diff 提议（DiffReviewView 审阅采纳）；缺回调时退化为直接落正文。
          if (typeof onStreamFinalize === 'function') {
            onStreamFinalize(
              wsChapterKey,
              finalText,
              data.turn_effect || null,
              data.chapter_target || null,
              Array.isArray(data.change_set || data.proposals) ? data.change_set || data.proposals : [],
            );
          } else {
            setManualContentByChapter((prev) => ({ ...(prev || {}), [wsChapterKey]: finalText }));
            if (activeChapterKeyRef.current === wsChapterKey) {
              setManualContent(finalText);
            }
          }
          setStreamingState({
            active: false,
            progress: 100,
            current: finalText.length,
            total: finalText.length,
          });
          setIsGenerating(false);
          if (activeChapterKeyRef.current === wsChapterKey) {
            dispatch({ type: 'SET_WORD_COUNT', payload: countWords(finalText, writingLanguage) });
            dispatch({ type: 'SET_SELECTION_COUNT', payload: 0 });
          } else {
            pushNotice(t('writingSession.chapterDone').replace('{n}', wsChapterKey));
          }
          setStatus('waiting_feedback');
          // stream_end 的 message 是 Agent 对本轮工作的真实答复，必须归类为 assistant；
          // 保存/工具过程等 activity 不应冒充系统对话或进入模型历史。
          // U9：message 为空时**不再补通用文案**。「草稿已生成…」是状态而非答复，
          // 冒充 assistant 消息违反 U8「可见对话只含真实 user/assistant 消息」；
          // 且 plan 多步执行时每步 stream_end 都会刷一条，夹在真实答复之间造成排布错乱。
          // 状态改由任务 dock、工具轨迹与编辑器正文表达。
          const answer = String(data.turn_effect?.message || '').trim();
          if (answer) {
            addMessage('assistant', answer, wsChapterKey);
          }
        }
        // 收尾 provisional 原生流（O1-O7）：agent 边生成边把 write_content/edit_lines 参数
        // 以 provisional token 推入编辑器；若本轮最终不是「有改动的 stream_end」，后端会发
        // stream_abort（取消/未完成/失败）或 stream_complete（仅回复、无改动）。此前前端未处理
        // 这两个事件 → serverStreamActive/streamingState 卡在 true → 一直显示「生成中」，
        // 且回退按钮被 !isGenerating 门控而永不出现。此处统一收尾并还原流式前原文。
        if (data.type === 'stream_abort' || data.type === 'stream_complete') {
          if (streamFlushRafByChapterRef.current[wsChapterKey]) {
            window.cancelAnimationFrame(streamFlushRafByChapterRef.current[wsChapterKey]);
            streamFlushRafByChapterRef.current[wsChapterKey] = null;
          }
          serverStreamActiveRef.current = false;
          if (streamingChapterKeyRef.current === wsChapterKey) {
            streamingChapterKeyRef.current = null;
          }
          streamBufferByChapterRef.current[wsChapterKey] = '';
          streamTextByChapterRef.current[wsChapterKey] = '';
          // provisional token 已覆盖编辑器为半成品；无最终 diff 可交付时还原流式前原文。
          // 基线未知（该章本会话没加载过）时不猜测：移除缓存条目让服务端回填真实正文，
          // 写入空串会把「没加载过」固化成「这一章是空的」。
          const original = readBaseline(streamOriginalByChapterRef?.current, wsChapterKey);
          const restorable = isKnownBaseline(original);
          setManualContentByChapter((prev) => {
            const next = { ...(prev || {}) };
            if (restorable) next[wsChapterKey] = original;
            else delete next[wsChapterKey];
            return next;
          });
          if (restorable && activeChapterKeyRef.current === wsChapterKey) {
            setManualContent(original);
          }
          setStreamingState({ active: false, progress: 0, current: 0, total: 0 });
          setIsGenerating(false);
        }
        if (data.type === 'error') addMessage('error', data.message, wsChapterKey);

        // Phase 5：真实的思考 / 工具调用过程（替代伪进度），渲染进行动轨迹。
        // Real thinking / tool-use steps (replace pseudo-progress) shown in the action trace.
        if (data.type === 'agent_thinking' && data.content) {
          const text = String(data.content);
          appendProgressEvent(
            {
              id: data.event_id || undefined,
              turnId: data.turn_id || undefined,
              stage: 'thinking',
              message: text,
              note: text,
            },
            wsChapterKey,
          );
        }
        // agent 工作时的自然语言旁白（非 thinking，对标 Cursor 的即时说明）→ 内联为 agent 正文。
        if (data.type === 'agent_message' && data.content) {
          appendProgressEvent(
            {
              id: data.event_id || undefined,
              turnId: data.turn_id || undefined,
              stage: 'assistant_text',
              message: String(data.content),
            },
            wsChapterKey,
          );
        }
        if (data.type === 'agent_tool_call') {
          appendProgressEvent(
            {
              stage: 'tool_call',
              turnId: data.turn_id || undefined,
              toolCallId: data.tool_call_id || undefined,
              toolName: data.name || '',
              toolArgs: _parseArgs(data.arguments),
            },
            wsChapterKey,
          );
        }
        if (data.type === 'agent_tool_result') {
          // 执行状态原样透传；预览截断与摘要文案由渲染层决定（U5 · plan.md §9.2.1）。
          appendProgressEvent(
            {
              stage: 'tool_result',
              turnId: data.turn_id || undefined,
              toolCallId: data.tool_call_id || undefined,
              toolName: data.name || '',
              toolStatus: data.status || 'succeeded',
              toolErrorCode: data.error_code || null,
              toolElapsedMs: Number(data.elapsed_ms) || 0,
              toolRecoverable: Boolean(data.recoverable),
              toolPreview: typeof data.result === 'string' ? data.result : '',
            },
            wsChapterKey,
          );
          // Agent 改写大纲后通知大纲编辑器同步（沿用既有 window 自定义事件约定），
          // 否则已打开的编辑器仍持有旧文本，下一次自动保存会把 Agent 的改动覆盖回去。
          if (data.name === 'edit_outline' && (data.status || 'succeeded') === 'succeeded') {
            window.dispatchEvent(new CustomEvent('wenshape:outline-updated'));
          }
        }
        if (data.type === 'agent_input_required') {
          onInputRequired?.(data);
        }

        if (data.status && data.message) {
          if (data.stage) {
            const backendEventId = data.event_id || data.trace_id;
            const event = {
              id: backendEventId ? `${backendEventId}:${data.stage}` : undefined,
              timestamp: data.timestamp || Date.now(),
              stage: data.stage,
              round: data.round,
              message: data.message,
              queries: data.queries || [],
              hits: data.hits,
              top_sources: data.top_sources || [],
              stop_reason: data.stop_reason,
              note: data.note,
              // plan 执行进度：后端已发 step_id/action，此前被白名单丢弃 → 前端只能显示文本。
              step_id: data.step_id,
              action: data.action,
              // U9 · plan_step_done 的逐步终态元数据。后端只发元数据（资产 ID 与字符增减量），
              // diff 正文经 execute_plan 的 HTTP 响应交付，不进 WS payload。
              step_status: data.step_status,
              terminal_state: data.terminal_state,
              iterations: data.iterations,
              error_code: data.error_code,
              assets: data.assets,
            };
            appendProgressEvent(event, wsChapterKey);
          } else {
            appendProgressEvent({ stage: 'system', message: data.message, note: data.note }, wsChapterKey);
          }
        }
      },
      {
        onStatus: (status) => {
          if (disposed) return;
          // 仅内部记录连接状态，不再向对话栏推送「重连中/已恢复」提示（WS 自动重连，提示无实际意义）。
          wsStatusRef.current = status;
        },
      },
    );

    wsRef.current = wsController;

    const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsHost = window.location.host;
    const traceWs = new WebSocket(`${wsProtocol}://${wsHost}/ws/trace`);

    traceWs.onmessage = (event) => {
      if (disposed) return;
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (_error) {
        return;
      }
      const payload = data?.payload;
      const payloadProjectId = String(payload?.project_id || payload?.projectId || '');
      if (payloadProjectId && payloadProjectId !== String(projectId)) return;

      if ((data.type === 'trace_event' || data.type === 'context_stats_update') && payload) {
        setTraceEvents((prev) => [...prev.slice(-99), { ...payload, event_type: data.type }]);
      }
      if (data.type === 'agent_trace_update' && payload) {
        setAgentTraces((prev) => {
          const existing = prev.findIndex(
            (item) => item.agent_name === payload.agent_name && String(item.project_id || projectId) === String(projectId),
          );
          if (existing >= 0) {
            const updated = [...prev];
            updated[existing] = payload;
            return updated;
          }
          return [...prev, payload];
        });
      }
    };

    traceWsRef.current = traceWs;

    return () => {
      disposed = true;
      if (wsController) wsController.close();
      if (traceWs) traceWs.close();
      wsRef.current = null;
      traceWsRef.current = null;
      // 清理残留 RAF，避免卸载后继续触发状态更新。
      // Cancel lingering RAF handlers to avoid post-unmount state updates.
      const rafMap = streamFlushRafByChapterRef.current || {};
      for (const key of Object.keys(rafMap)) {
        if (rafMap[key]) {
          window.cancelAnimationFrame(rafMap[key]);
        }
      }
      streamFlushRafByChapterRef.current = {};
      serverStreamActiveRef.current = false;
      streamingChapterKeyRef.current = null;
    };
  }, [
    projectId,
    noChapterKey,
    addMessage,
    appendProgressEvent,
    clearDiffReview,
    dispatch,
    pushNotice,
    serverStreamActiveRef,
    serverStreamUsedRef,
    setAgentTraces,
    setIsGenerating,
    setManualContent,
    setManualContentByChapter,
    setStatus,
    setStreamingState,
    setTraceEvents,
    stopStreaming,
    streamBufferByChapterRef,
    streamFlushRafByChapterRef,
    streamingChapterKeyRef,
    streamTextByChapterRef,
    t,
    traceWsRef,
    wsRef,
    wsStatusRef,
    activeChapterKeyRef,
    lastGeneratedByChapterRef,
    writingLanguage,
    streamOriginalByChapterRef,
    onStreamFinalize,
    onInputRequired,
  ]);
}
