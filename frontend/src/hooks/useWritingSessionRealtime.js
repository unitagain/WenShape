import { useEffect } from 'react';
import { createWebSocket } from '../api';
import { getStreamingPreference } from '../components/ide/TitleBar';
import { countWords } from '../utils/writingSessionHelpers';

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
    currentDraftVersion,
    dispatch,
    handleDraftV1,
    handleFinalDraft,
    handleSceneBrief,
    pushNotice,
    serverStreamActiveRef,
    serverStreamUsedRef,
    setAgentTraces,
    setAiLockedChapter,
    setCurrentDraft,
    setCurrentDraftVersion,
    setIsGenerating,
    setManualContent,
    setManualContentByChapter,
    setProposals,
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
}) {
    useEffect(() => {
        if (!projectId) return;

        const wsController = createWebSocket(
            projectId,
            (data) => {
                const wsChapterKey = data?.chapter ? String(data.chapter) : noChapterKey;
                if (data.type === 'start_ack') {
                    appendProgressEvent({ stage: 'session_start', message: t('writingSession.sessionStarted') }, wsChapterKey);
                }
                if (data.type === 'stream_start') {
                    if (wsChapterKey && wsChapterKey !== noChapterKey) {
                        setAiLockedChapter(wsChapterKey);
                    }
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
                    setManualContentByChapter((prev) => ({ ...(prev || {}), [wsChapterKey]: '' }));
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
                    setManualContentByChapter((prev) => ({ ...(prev || {}), [wsChapterKey]: finalText }));
                    if (activeChapterKeyRef.current === wsChapterKey) {
                        setManualContent(finalText);
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
                    if (data.draft) {
                        setCurrentDraft(data.draft);
                        setCurrentDraftVersion(data.draft.version || currentDraftVersion);
                    }
                    if (data.proposals) {
                        setProposals(data.proposals);
                    }
                    setStatus('waiting_feedback');
                    addMessage('assistant', t('writingSession.draftGenerated'), wsChapterKey);
                }
                if (data.type === 'scene_brief') handleSceneBrief(data.data, wsChapterKey);
                if (data.type === 'draft_v1') handleDraftV1(data.data, wsChapterKey);
                if (data.type === 'final_draft') handleFinalDraft(data.data, wsChapterKey);
                if (data.type === 'error') addMessage('error', data.message, wsChapterKey);

                if (data.status && data.message) {
                    if (data.stage) {
                        const event = {
                            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                            timestamp: data.timestamp || Date.now(),
                            stage: data.stage,
                            round: data.round,
                            message: data.message,
                            queries: data.queries || [],
                            hits: data.hits,
                            top_sources: data.top_sources || [],
                            stop_reason: data.stop_reason,
                            note: data.note,
                        };
                        appendProgressEvent(event, wsChapterKey);
                    } else {
                        appendProgressEvent({ stage: 'system', message: data.message, note: data.note }, wsChapterKey);
                    }
                }
            },
            {
                onStatus: (status) => {
                    if (wsStatusRef.current !== status) {
                        if (status === 'reconnecting') {
                            appendProgressEvent({ stage: 'connection', message: t('writingSession.connectionReconnecting') }, noChapterKey);
                        }
                        if (status === 'connected' && wsStatusRef.current === 'reconnecting') {
                            appendProgressEvent({ stage: 'connection', message: t('writingSession.connectionRestored') }, noChapterKey);
                        }
                        if (status === 'disconnected') {
                            appendProgressEvent({ stage: 'connection', message: t('writingSession.connectionLost') }, noChapterKey);
                        }
                    }

                    wsStatusRef.current = status;
                },
            }
        );

        wsRef.current = wsController;

        const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const wsHost = window.location.host;
        const traceWs = new WebSocket(`${wsProtocol}://${wsHost}/ws/trace`);

        traceWs.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'trace_event' && data.payload) {
                setTraceEvents((prev) => [...prev.slice(-99), data.payload]);
            }
            if (data.type === 'agent_trace_update' && data.payload) {
                setAgentTraces((prev) => {
                    const existing = prev.findIndex((item) => item.agent_name === data.payload.agent_name);
                    if (existing >= 0) {
                        const updated = [...prev];
                        updated[existing] = data.payload;
                        return updated;
                    }
                    return [...prev, data.payload];
                });
            }
        };

        traceWsRef.current = traceWs;

        return () => {
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
        currentDraftVersion,
        dispatch,
        handleDraftV1,
        handleFinalDraft,
        handleSceneBrief,
        pushNotice,
        serverStreamActiveRef,
        serverStreamUsedRef,
        setAgentTraces,
        setAiLockedChapter,
        setCurrentDraft,
        setCurrentDraftVersion,
        setIsGenerating,
        setManualContent,
        setManualContentByChapter,
        setProposals,
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
    ]);
}
