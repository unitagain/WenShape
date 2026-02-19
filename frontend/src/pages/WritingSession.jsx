/**
 * 文枢 WenShape - 深度上下文感知的智能体小说创作系统
 * WenShape - Deep Context-Aware Agent-Based Novel Writing System
 *
 * Copyright © 2025-2026 WenShape Team
 * License: PolyForm Noncommercial License 1.0.0
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import useSWR from 'swr';
import { motion, AnimatePresence } from 'framer-motion';
import { useParams, useNavigate } from 'react-router-dom';
import { sessionAPI, createWebSocket, draftsAPI, cardsAPI, projectsAPI, volumesAPI, memoryPackAPI } from '../api';
import { Button, Input } from '../components/ui/core';
import AgentsPanel from '../components/ide/panels/AgentsPanel';
import AgentStatusPanel from '../components/ide/AgentStatusPanel';
import { X, Loader2 } from 'lucide-react';
import { ChapterCreateDialog } from '../components/project/ChapterCreateDialog';
import { IDELayout } from '../components/ide/IDELayout';
import { IDEProvider } from '../context/IDEContext';
import { useIDE } from '../context/IDEContext';
import AnalysisReviewDialog from '../components/writing/AnalysisReviewDialog';
import PreWritingQuestionsDialog from '../components/PreWritingQuestionsDialog';
import StreamingDraftView from '../components/writing/StreamingDraftView';
import { buildLineDiff, applyDiffOpsWithDecisions } from '../lib/diffUtils';
import DiffReviewView from '../components/ide/DiffReviewView';
import SaveMenu from '../components/writing/SaveMenu';
import FanfictionView from './FanfictionView';
import logger from '../utils/logger';
import {
    fetchChapterContent,
    countChars,
    escapeRegExp,
    getSelectionStats,
    normalizeStars,
    parseListInput,
    formatListInput,
    formatRulesInput,
    hasDeletionIntent,
    stabilizeRevisionTail,
} from '../utils/writingSessionHelpers';

/**
 * WritingSessionContent - 写作会话主流程组件
 *
 * 统一的写作 IDE 界面，集成 AI 写作、编辑、分析等功能。
 * 使用 IDE Layout 提供三段式布局（活动栏、左侧面板、编辑区、右侧面板、底部状态栏）。
 *
 * 主要功能：
 * - 实时 WebSocket 连接管理和消息处理
 * - 章节内容编辑和版本管理
 * - AI 驱动的写作、编辑、分析建议
 * - 交互式对话和反馈流程
 * - 草稿保存和历史记录
 *
 * @component
 * @param {boolean} [isEmbedded=false] - 是否为嵌入模式（默认完整模式）
 * @returns {JSX.Element} 写作会话主界面
 */
function WritingSessionContent({ isEmbedded = false }) {
    const { projectId } = useParams();
    const navigate = useNavigate();
    const { state, dispatch } = useIDE();

    // ========================================================================
    // 项目和会话基本信息 / Project and Session Information
    // ========================================================================
    // 项目数据状态 / Project data from API
    const [project, setProject] = useState(null);
    const prevProjectIdRef = useRef(null);

    useEffect(() => {
        if (projectId) {
            projectsAPI.get(projectId).then(res => setProject(res.data));
            dispatch({ type: 'SET_PROJECT_ID', payload: projectId });
        }
    }, [projectId, dispatch]);

    // 项目切换时清理所有会话状态，防止数据污染
    // 使用 useRef 判断 projectId 是否真正变化，避免不必要的清理
    useEffect(() => {
        if (prevProjectIdRef.current && prevProjectIdRef.current !== projectId) {
            // 项目真正切换了：清理所有写作会话状态
            setDiffReview(null);
            setDiffDecisions({});
            setCurrentDraft(null);
            setManualContent('');
            setManualContentByChapter({});
            setMessagesByChapter({});
            setProgressEventsByChapter({});
            setDraftV1(null);
            setSceneBrief(null);
            setFeedback('');
            setChapterInfo({ chapter: null, chapter_title: null, content: null });
            setStatus('idle');
            setSelectionInfo({ start: 0, end: 0, text: '' });
            setAttachedSelection(null);
            setEditScope('document');
            setAiLockedChapter(null);
            if (streamingRef.current?.timer) {
                streamingRef.current.timer();
            }
            streamingRef.current = null;
            setStreamingState({ active: false, progress: 0, current: 0, total: 0 });
        }
        prevProjectIdRef.current = projectId;
    }, [projectId]);



    // UI State
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [showStartModal, setShowStartModal] = useState(true);
    const [showChapterDialog, setShowChapterDialog] = useState(false);
    const [chapters, setChapters] = useState([]);

    // Save/Analyze UI
    const [isSaving, setIsSaving] = useState(false);
    const [analysisDialogOpen, setAnalysisDialogOpen] = useState(false);
    const [analysisItems, setAnalysisItems] = useState([]);
    const [analysisLoading, setAnalysisLoading] = useState(false);
    const [analysisSaving, setAnalysisSaving] = useState(false);

    // Proposal State
    const [proposals, setProposals] = useState([]);
    const [rejectedItems, setRejectedItems] = useState([]);

    // Logic State
    const [status, setStatus] = useState('idle'); // idle, starting, editing, waiting_feedback, completed
    const [messagesByChapter, setMessagesByChapter] = useState({});
    const [progressEventsByChapter, setProgressEventsByChapter] = useState({});
    const [currentDraft, setCurrentDraft] = useState(null);
    const [manualContent, setManualContent] = useState(''); // Textarea content
    const [manualContentByChapter, setManualContentByChapter] = useState({});
    const [selectionInfo, setSelectionInfo] = useState({ start: 0, end: 0, text: '' });
    const [attachedSelection, setAttachedSelection] = useState(null); // { start, end, text }
    const [editScope, setEditScope] = useState('document'); // document | selection
    const [sceneBrief, setSceneBrief] = useState(null);
    const [draftV1, setDraftV1] = useState(null);
    const [feedback, setFeedback] = useState('');
    const [diffReview, setDiffReview] = useState(null);
    const [diffDecisions, setDiffDecisions] = useState({});
    const lastFeedbackRef = useRef('');
    const lastGeneratedByChapterRef = useRef({});
    const streamBufferByChapterRef = useRef({});
    const streamTextByChapterRef = useRef({});
    const streamFlushRafByChapterRef = useRef({});
    const serverStreamActiveRef = useRef(false);
    const serverStreamUsedRef = useRef(false);
    const streamingChapterKeyRef = useRef(null);

    const [showPreWriteDialog, setShowPreWriteDialog] = useState(false);
    const [preWriteQuestions, setPreWriteQuestions] = useState([]);
    const [pendingStartPayload, setPendingStartPayload] = useState(null);

    const manualContentByChapterRef = useRef(manualContentByChapter);
    useEffect(() => {
        manualContentByChapterRef.current = manualContentByChapter;
    }, [manualContentByChapter]);

    // AI 锁定章：写作/编辑进行中时，右侧面板锁死在该章节（中央可切换查看/手改其他章节）
    const [aiLockedChapter, setAiLockedChapter] = useState(null);
    const aiLockedChapterRef = useRef(aiLockedChapter);
    useEffect(() => {
        aiLockedChapterRef.current = aiLockedChapter;
    }, [aiLockedChapter]);

    // 轻提示（不打断、不强跳转）
    const [notice, setNotice] = useState(null);
    const noticeTimerRef = useRef(null);
    const pushNotice = useCallback((text) => {
        if (!text) return;
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setNotice({ id, text: String(text) });
        if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = window.setTimeout(() => setNotice(null), 2600);
    }, []);
    useEffect(() => {
        return () => {
            if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
        };
    }, []);

    // WebSocket
    const wsRef = useRef(null);
    const traceWsRef = useRef(null);
    const wsStatusRef = useRef('disconnected');
    const [isGenerating, setIsGenerating] = useState(false);
    const streamingRef = useRef(null);
    const [streamingState, setStreamingState] = useState({
        active: false,
        progress: 0,
        current: 0,
        total: 0
    });

    // Trace Events for AgentTimeline
    const [traceEvents, setTraceEvents] = useState([]);
    const [agentTraces, setAgentTraces] = useState([]);

    // Chapter Info
    const [chapterInfo, setChapterInfo] = useState({
        chapter: null,
        chapter_title: null,
        content: null,
    });

    const NO_CHAPTER_KEY = '__no_chapter__';
    const activeChapterKey = chapterInfo.chapter ? String(chapterInfo.chapter) : NO_CHAPTER_KEY;

    const activeChapterKeyRef = useRef(activeChapterKey);
    useEffect(() => {
        activeChapterKeyRef.current = activeChapterKey;
    }, [activeChapterKey]);


    // Draft version state
    const [currentDraftVersion, setCurrentDraftVersion] = useState('v1');

    // Agent mode (for AgentStatusPanel)
    const [agentMode, setAgentMode] = useState('create'); // 'create' | 'edit'
    const [contextDebugByChapter, setContextDebugByChapter] = useState({});
    const [editContextMode, setEditContextMode] = useState('quick'); // quick | full

    const agentBusy =
        Boolean(aiLockedChapter) &&
        (Boolean(diffReview) ||
            showPreWriteDialog ||
            status === 'starting' ||
            status === 'waiting_user_input' ||
            isGenerating ||
            streamingState.active);

    const agentChapterKey = agentBusy
        ? String(aiLockedChapter)
        : activeChapterKey;

    const isStreamingForActiveChapter =
        streamingState.active && streamingChapterKeyRef.current === activeChapterKey;

    const isDiffReviewForActiveChapter =
        Boolean(diffReview) && String(diffReview?.chapterKey || '') === activeChapterKey;

    const lockedOnActiveChapter =
        agentBusy && String(aiLockedChapter || '') === activeChapterKey;

    const canUseWriter = countChars(
        agentBusy
            ? (manualContentByChapter[String(aiLockedChapter || '')] ?? '')
            : manualContent
    ) === 0;

    const messages = messagesByChapter[agentChapterKey] || [];
    const progressEvents = progressEventsByChapter[agentChapterKey] || [];
    const contextDebug = contextDebugByChapter[agentChapterKey] || null;

    useEffect(() => {
        if (!isGenerating && !canUseWriter && agentMode === 'create') {
            setAgentMode('edit');
        }
    }, [canUseWriter, agentMode, isGenerating]);

    useEffect(() => {
        if (agentMode !== 'edit') return;
        if (!attachedSelection?.text?.trim()) {
            if (editScope === 'selection') setEditScope('document');
            return;
        }
        if (editScope === 'document') setEditScope('selection');
    }, [agentMode, attachedSelection, editScope]);

    useEffect(() => {
        if (!aiLockedChapter) return;
        if (agentBusy) return;
        setAiLockedChapter(null);
    }, [aiLockedChapter, agentBusy]);

    useEffect(() => {
        if (!projectId) return;

        const wsController = createWebSocket(
            projectId,
            (data) => {
                const wsChapterKey = data?.chapter ? String(data.chapter) : NO_CHAPTER_KEY;
                if (data.type === 'start_ack') appendProgressEvent({ stage: 'session_start', message: '会话已启动' }, wsChapterKey);
                if (data.type === 'stream_start') {
                    if (wsChapterKey && wsChapterKey !== NO_CHAPTER_KEY) {
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
                        total: data.total || 0
                    });
                }
                if (data.type === 'token' && typeof data.content === 'string') {
                    if (!serverStreamActiveRef.current) {
                        return;
                    }
                    streamBufferByChapterRef.current[wsChapterKey] =
                        (streamBufferByChapterRef.current[wsChapterKey] || '') + data.content;
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
                                progress: prev.total ? Math.round((current / prev.total) * 100) : prev.progress
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
                        total: finalText.length
                    });
                    setIsGenerating(false);
                    if (activeChapterKeyRef.current === wsChapterKey) {
                        dispatch({ type: 'SET_WORD_COUNT', payload: countChars(finalText) });
                        dispatch({ type: 'SET_SELECTION_COUNT', payload: 0 });
                    } else {
                        pushNotice(`第 ${wsChapterKey} 章撰写完成，可切换查看。`);
                    }
                    if (data.draft) {
                        setCurrentDraft(data.draft);
                        setCurrentDraftVersion(data.draft.version || currentDraftVersion);
                    }
                    if (data.proposals) {
                        setProposals(data.proposals);
                    }
                    setStatus('waiting_feedback');
                    addMessage('assistant', '草稿已生成，可继续反馈或手动编辑。', wsChapterKey);
                }
                if (data.type === 'scene_brief') handleSceneBrief(data.data, wsChapterKey);
                if (data.type === 'draft_v1') handleDraftV1(data.data, wsChapterKey);
                if (data.type === 'final_draft') handleFinalDraft(data.data, wsChapterKey);
                if (data.type === 'error') addMessage('error', data.message, wsChapterKey);

                // Handle backend status updates (progress)
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
                            note: data.note
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
                            appendProgressEvent({ stage: 'connection', message: '连接中断，正在重连…' }, NO_CHAPTER_KEY);
                        }
                        if (status === 'connected' && wsStatusRef.current === 'reconnecting') {
                            appendProgressEvent({ stage: 'connection', message: '连接已恢复' }, NO_CHAPTER_KEY);
                        }
                        if (status === 'disconnected') {
                            appendProgressEvent({ stage: 'connection', message: '连接已断开' }, NO_CHAPTER_KEY);
                        }
                    }

                    wsStatusRef.current = status;
                }
            }
        );

        wsRef.current = wsController;

        // Connect to Trace WebSocket for AgentTimeline
        const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const wsHost = window.location.host;
        const traceWs = new WebSocket(`${wsProtocol}://${wsHost}/ws/trace`);

        traceWs.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'trace_event' && data.payload) {
                setTraceEvents(prev => [...prev.slice(-99), data.payload]); // Keep last 100 events
            }
            if (data.type === 'agent_trace_update' && data.payload) {
                setAgentTraces(prev => {
                    const existing = prev.findIndex(t => t.agent_name === data.payload.agent_name);
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
        };
    }, [projectId]);

    // Card State
    const [activeCard, setActiveCard] = useState(null);
    const [cardForm, setCardForm] = useState({
        name: '',
        description: '',
        aliases: '',
        stars: 1,
        category: '',
        rules: '',
        immutable: 'unset'
    });

    // SWR for Chapter Content
    const { data: loadedContent, mutate: mutateChapter } = useSWR(
        chapterInfo.chapter ? ['chapter', projectId, chapterInfo.chapter] : null,
        fetchChapterContent,
        {
            revalidateOnFocus: false,
            dedupingInterval: 60000, // Cache for 1 minute before checking again
            keepPreviousData: false // Don't show previous chapter data while loading (we handle this with manualContent update)
        }
    );

    const { data: volumes = [] } = useSWR(
        projectId ? ['volumes', projectId] : null,
        () => volumesAPI.list(projectId).then(res => res.data),
        { revalidateOnFocus: false }
    );

    const memoryPackChapter = agentBusy ? aiLockedChapter : chapterInfo.chapter;
    const { data: memoryPackStatus } = useSWR(
        projectId && memoryPackChapter ? ['memory-pack', projectId, memoryPackChapter] : null,
        () => memoryPackAPI.getStatus(projectId, memoryPackChapter).then(res => res.data),
        { revalidateOnFocus: false, refreshInterval: 5000 }
    );

    // Sync SWR data to manualContent
    useEffect(() => {
        if (loadedContent === undefined || state.unsavedChanges) {
            return;
        }
        if (isStreamingForActiveChapter || lockedOnActiveChapter || isDiffReviewForActiveChapter) {
            return;
        }

        const chapterKey = activeChapterKey;
        if (chapterKey === NO_CHAPTER_KEY) return;

        const lastGeneratedForChapter = Boolean(lastGeneratedByChapterRef.current?.[chapterKey]);
        if (lastGeneratedForChapter && manualContent && !(loadedContent || '').trim()) {
            return;
        }

        setManualContentByChapter((prev) => ({ ...(prev || {}), [chapterKey]: loadedContent }));
        setManualContent(loadedContent);
        dispatch({ type: 'SET_WORD_COUNT', payload: countChars(loadedContent) });
        dispatch({ type: 'SET_SELECTION_COUNT', payload: 0 });
        lastGeneratedByChapterRef.current[chapterKey] = false;
        // Only center cursor if we just switched chapters (optional optimization)
        // dispatch({ type: 'SET_CURSOR_POSITION', payload: { line: 1, column: 1 } });
    }, [
        loadedContent,
        dispatch,
        manualContent,
        state.unsavedChanges,
        activeChapterKey,
        NO_CHAPTER_KEY,
        isStreamingForActiveChapter,
        lockedOnActiveChapter,
        isDiffReviewForActiveChapter,
    ]);

    useEffect(() => {
        loadChapters();
    }, [projectId]);

    useEffect(() => {
        let active = true;
        const loadTitle = async () => {
            if (!projectId || !chapterInfo.chapter) return;
            if (chapterInfo.chapter_title && chapterInfo.chapter_title.trim()) return;
            try {
                const summaryResp = await draftsAPI.getSummary(projectId, chapterInfo.chapter);
                const summary = summaryResp.data || {};
                const title = summary.title || summary.chapter_title || '';
                if (active && title) {
                    setChapterInfo((prev) => ({ ...prev, chapter_title: title }));
                }
            } catch (e) {
                // ignore missing summary
            }
        };
        loadTitle();
        return () => {
            active = false;
        };
    }, [projectId, chapterInfo.chapter, chapterInfo.chapter_title]);

    // 监听 Context 中的 Dialog 状态
    useEffect(() => {
        if (state.createChapterDialogOpen !== showChapterDialog) {
            setShowChapterDialog(state.createChapterDialogOpen);
        }
    }, [state.createChapterDialogOpen]);

    const loadChapters = async () => {
        try {
            const resp = await draftsAPI.listChapters(projectId);
            const list = resp.data || [];
            setChapters(list);
        } catch (e) {
            logger.error('Failed to load chapters:', e);
        }
    };

    const handleChapterSelect = async (chapter, presetTitle = '') => {
        const nextChapterKey = chapter ? String(chapter) : NO_CHAPTER_KEY;
        const lockedKey = aiLockedChapterRef.current ? String(aiLockedChapterRef.current) : null;
        const preserveAgent = Boolean(lockedKey) && agentBusy;

        // 缓存当前章节内容，避免切章丢失
        if (chapterInfo.chapter) {
            const currentKey = String(chapterInfo.chapter);
            setManualContentByChapter((prev) => ({ ...(prev || {}), [currentKey]: manualContent }));
        }

        // 非写作/编辑进行中：切章时清理流式与差异态
        if (!preserveAgent) {
            stopStreaming();
            clearDiffReview();
            setStatus('editing');
        } else if (lockedKey && nextChapterKey !== lockedKey) {
            pushNotice(`正在撰写第 ${lockedKey} 章，AI 面板已锁定；已切换查看第 ${nextChapterKey} 章。`);
        }

        // Just set the chapter, let SWR handle fetching
        setChapterInfo({ chapter, chapter_title: presetTitle || '', content: '' }); // content will be filled by SWR
        setSelectionInfo({ start: 0, end: 0, text: '' });
        setAttachedSelection(null);
        setEditScope('document');

        // 优先使用本地缓存，减少切章时的“空白闪烁”
        if (nextChapterKey && nextChapterKey !== NO_CHAPTER_KEY) {
            const cached = manualContentByChapterRef.current?.[nextChapterKey];
            if (typeof cached === 'string') {
                setManualContent(cached);
                dispatch({ type: 'SET_WORD_COUNT', payload: countChars(cached) });
                dispatch({ type: 'SET_SELECTION_COUNT', payload: 0 });
            } else {
                setManualContent('');
                dispatch({ type: 'SET_WORD_COUNT', payload: 0 });
                dispatch({ type: 'SET_SELECTION_COUNT', payload: 0 });
            }
        }
        try {
            const summaryResp = await draftsAPI.getSummary(projectId, chapter);
            const summary = summaryResp.data || {};
            const normalizedChapter = summary.chapter || chapter;
            const title = summary.title || summary.chapter_title || '';
            setChapterInfo((prev) => ({
                ...prev,
                chapter: normalizedChapter,
                chapter_title: title || prev.chapter_title || ''
            }));
            if (normalizedChapter !== chapter) {
                dispatch({
                    type: 'SET_ACTIVE_DOCUMENT',
                    payload: { type: 'chapter', id: normalizedChapter, title: title || presetTitle || '' }
                });
            }
        } catch (e) {
            // Summary may not exist yet.
        }
    };

    const handleChapterCreate = async (chapterData) => {
        // Handle object from ChapterCreateDialog or direct arguments
        const chapterNum = typeof chapterData === 'object' ? chapterData.id : chapterData;
        const chapterTitle = typeof chapterData === 'object' ? chapterData.title : arguments[1];

        // Persist the new chapter immediately
        setIsSaving(true);
        let normalizedChapter = chapterNum;
        try {
            const resp = await draftsAPI.updateContent(projectId, chapterNum, {
                content: '',
                title: chapterTitle
            });
            normalizedChapter = resp.data?.chapter || chapterNum;
            addMessage('system', `已创建章节：${normalizedChapter}`, normalizedChapter);
            dispatch({
                type: 'SET_ACTIVE_DOCUMENT',
                payload: { type: 'chapter', id: normalizedChapter, title: chapterTitle || '' }
            });
        } catch (e) {
            addMessage('error', '创建章节失败: ' + e.message);
        } finally {
            setIsSaving(false);
        }

        setChapterInfo({ chapter: normalizedChapter, chapter_title: chapterTitle, content: '' });
        setManualContent('');
        stopStreaming();
        clearDiffReview();
        setShowChapterDialog(false);
        setStatus('idle');
        await loadChapters();
    };

    const addMessage = useCallback((type, content, chapterOverride = null) => {
        const key = chapterOverride ? String(chapterOverride) : activeChapterKey;
        if (!key || key === NO_CHAPTER_KEY) {
            return;
        }
        setMessagesByChapter((prev) => {
            const next = { ...(prev || {}) };
            const existing = Array.isArray(next[key]) ? next[key] : [];
            next[key] = [...existing, { type, content, time: new Date() }].slice(-200);
            return next;
        });
    }, [activeChapterKey, NO_CHAPTER_KEY]);

    const appendProgressEvent = useCallback((partial, chapterOverride = null) => {
        const key = chapterOverride ? String(chapterOverride) : activeChapterKey;
        if (!key || key === NO_CHAPTER_KEY) {
            return;
        }
        const event = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            timestamp: Date.now(),
            ...partial
        };
        setProgressEventsByChapter((prev) => {
            const next = { ...(prev || {}) };
            const existing = Array.isArray(next[key]) ? next[key] : [];
            next[key] = [...existing.slice(-199), event];
            return next;
        });
    }, [activeChapterKey, NO_CHAPTER_KEY]);

    // Auto Save（类似 VSCode：检测到变更后自动保存）
    const autosaveTimerRef = useRef(null);
    const autosaveInFlightRef = useRef(false);
    const autosaveLastPayloadRef = useRef({ chapter: null, content: null, title: null });

    useEffect(() => {
        if (!state.unsavedChanges) return;
        if (!projectId || !chapterInfo.chapter) return;
        if (isStreamingForActiveChapter || lockedOnActiveChapter || isDiffReviewForActiveChapter) return;

        const nextContent = String(manualContent || '');
        const nextTitle = String(chapterInfo.chapter_title || '').trim() || null;

        const last = autosaveLastPayloadRef.current || {};
        const sameChapter = String(last.chapter || '') === String(chapterInfo.chapter);
        const sameContent = sameChapter && String(last.content || '') === nextContent;
        const sameTitle = sameChapter && (last.title || null) === nextTitle;
        if (sameContent && sameTitle) return;

        if (autosaveTimerRef.current) {
            window.clearTimeout(autosaveTimerRef.current);
        }

        autosaveTimerRef.current = window.setTimeout(async () => {
            if (autosaveInFlightRef.current) return;
            autosaveInFlightRef.current = true;
            try {
                const payload = { content: nextContent };
                if (nextTitle) payload.title = nextTitle;

                const resp = await draftsAPI.autosaveContent(projectId, chapterInfo.chapter, payload);
                if (resp.data?.success) {
                    autosaveLastPayloadRef.current = { chapter: chapterInfo.chapter, content: nextContent, title: nextTitle };
                    await mutateChapter(nextContent, false);
                    dispatch({ type: 'SET_AUTOSAVED' });
                }
            } catch (e) {
                dispatch({ type: 'SET_UNSAVED' });
                addMessage('error', '自动保存失败: ' + (e.response?.data?.detail || e.message));
            } finally {
                autosaveInFlightRef.current = false;
            }
        }, 1200);

        return () => {
            if (autosaveTimerRef.current) {
                window.clearTimeout(autosaveTimerRef.current);
                autosaveTimerRef.current = null;
            }
        };
    }, [
        state.unsavedChanges,
        projectId,
        chapterInfo.chapter,
        chapterInfo.chapter_title,
        manualContent,
        isStreamingForActiveChapter,
        lockedOnActiveChapter,
        isDiffReviewForActiveChapter,
        mutateChapter,
        dispatch,
        addMessage,
    ]);

    const clearDiffReview = useCallback(() => {
        setDiffReview(null);
        setDiffDecisions({});
    }, []);

    const stopStreaming = useCallback(() => {
        if (streamingRef.current?.timer) {
            streamingRef.current.timer();
        }
        streamingRef.current = null;
        setStreamingState({
            active: false,
            progress: 0,
            current: 0,
            total: 0
        });
    }, []);

    // 当资源管理器清空/删除当前章节时，主动回到空态，避免编辑区残留旧章节内容
    useEffect(() => {
        if (state.activeDocument) return;
        stopStreaming();
        clearDiffReview();
        setActiveCard(null);
        setChapterInfo({ chapter: null, chapter_title: null, content: null });
        setManualContent('');
        setStatus('idle');
    }, [clearDiffReview, state.activeDocument, stopStreaming]);

    const startStreamingDraft = useCallback((targetText, options = {}) => {
        const { onComplete, chapterKey } = options;
        const resolvedChapterKey = chapterKey ? String(chapterKey) : activeChapterKeyRef.current;
        stopStreaming();
        streamingChapterKeyRef.current = resolvedChapterKey;

        const safeText = targetText || '';
        if (!safeText) {
            setManualContentByChapter((prev) => ({ ...(prev || {}), [resolvedChapterKey]: '' }));
            if (activeChapterKeyRef.current === resolvedChapterKey) {
                setManualContent('');
            }
            setIsGenerating(false);
            streamingChapterKeyRef.current = null;
            onComplete?.();
            return;
        }

        dispatch({ type: 'SET_UNSAVED' });
        setIsGenerating(true);
        const total = safeText.length;
        const charsPerSecond = Math.min(420, Math.max(180, Math.round(total / 3)));
        let index = 0;
        let lastTs = performance.now();
        let rafId = null;

        setManualContentByChapter((prev) => ({ ...(prev || {}), [resolvedChapterKey]: '' }));
        if (activeChapterKeyRef.current === resolvedChapterKey) {
            setManualContent('');
        }
        setStreamingState({
            active: true,
            progress: 0,
            current: 0,
            total
        });
        lastGeneratedByChapterRef.current[resolvedChapterKey] = true;

        const initialBurst = Math.min(total, Math.max(12, Math.floor(total * 0.03)));
        if (initialBurst > 0) {
            index = initialBurst;
            const burstText = safeText.slice(0, index);
            setManualContentByChapter((prev) => ({ ...(prev || {}), [resolvedChapterKey]: burstText }));
            if (activeChapterKeyRef.current === resolvedChapterKey) {
                setManualContent(burstText);
            }
            setStreamingState({
                active: index < total,
                progress: Math.round((index / total) * 100),
                current: index,
                total
            });
        }

        const tick = (ts) => {
            const delta = Math.max(0, ts - lastTs);
            const increment = Math.max(1, Math.floor((delta / 1000) * charsPerSecond));
            index = Math.min(total, index + increment);
            lastTs = ts;

            const partial = safeText.slice(0, index);
            setManualContentByChapter((prev) => ({ ...(prev || {}), [resolvedChapterKey]: partial }));
            if (activeChapterKeyRef.current === resolvedChapterKey) {
                setManualContent(partial);
            }
            setStreamingState({
                active: index < total,
                progress: Math.round((index / total) * 100),
                current: index,
                total
            });

            if (index >= total) {
                streamingRef.current = null;
                setIsGenerating(false);
                streamingChapterKeyRef.current = null;
                if (activeChapterKeyRef.current === resolvedChapterKey) {
                    dispatch({ type: 'SET_WORD_COUNT', payload: countChars(safeText) });
                    dispatch({ type: 'SET_SELECTION_COUNT', payload: 0 });
                } else {
                    pushNotice(`第 ${resolvedChapterKey} 章撰写完成，可切换查看。`);
                }
                onComplete?.();
                return;
            }

            rafId = window.requestAnimationFrame(tick);
        };

        rafId = window.requestAnimationFrame(tick);
        streamingRef.current = {
            timer: () => {
                if (rafId) window.cancelAnimationFrame(rafId);
            }
        };
    }, [dispatch, stopStreaming, pushNotice]);

    useEffect(() => {
        return () => {
            stopStreaming();
        };
    }, [stopStreaming]);

    // 监听 Context 中的文档选择（章节或卡片）
    useEffect(() => {
        if (!state.activeDocument) return;

        if (state.activeDocument.type === 'chapter' && state.activeDocument.id) {
            setActiveCard(null); // Clear card state
            const presetTitle =
                state.activeDocument.data?.title ||
                state.activeDocument.data?.chapter_title ||
                state.activeDocument.title ||
                state.activeDocument.chapter_title ||
                '';
            handleChapterSelect(state.activeDocument.id, presetTitle);
        } else if (['character', 'world'].includes(state.activeDocument.type)) {
            // Switch to Card Mode
            stopStreaming();
            clearDiffReview();
            setChapterInfo({ chapter: null, chapter_title: null, content: null });

            // Initial setup with basic info
            const cardData = state.activeDocument.data || { name: state.activeDocument.id };
            const originalName = state.activeDocument.id || cardData.name || '';
            const isNew = Boolean(state.activeDocument.isNew || cardData.isNew || !originalName);
            setActiveCard({
                ...cardData,
                type: state.activeDocument.type,
                isNew,
                originalName
            });
            setCardForm({
                name: cardData.name || '',
                description: '',
                aliases: formatListInput(cardData.aliases),
                stars: normalizeStars(cardData.stars),
                category: cardData.category || '',
                rules: formatRulesInput(cardData.rules),
                immutable: cardData.immutable === true ? 'true' : cardData.immutable === false ? 'false' : 'unset'
            });
            setStatus('card_editing');

            // Fetch full details
            const fetchCardDetails = async () => {
                try {
                    let resp;
                    if (state.activeDocument.type === 'character') {
                        resp = await cardsAPI.getCharacter(projectId, state.activeDocument.id);
                    } else {
                        resp = await cardsAPI.getWorld(projectId, state.activeDocument.id);
                    }
                    const fullData = resp?.data || {};
                    setCardForm({
                        name: fullData.name || cardData.name || '',
                        description: fullData.description || '',
                        aliases: formatListInput(fullData.aliases),
                        stars: normalizeStars(fullData.stars),
                        category: fullData.category || '',
                        rules: formatRulesInput(fullData.rules),
                        immutable: fullData.immutable === true ? 'true' : fullData.immutable === false ? 'false' : 'unset'
                    });
                } catch (e) {
                    logger.error("Failed to fetch card details", e);
                    addMessage('error', '加载卡片详情失败: ' + e.message);
                }
            };

            if (state.activeDocument.id) {
                fetchCardDetails();
            }
        }
    }, [state.activeDocument, stopStreaming, clearDiffReview, projectId]);

    // Handlers
    const handleStart = async (chapter, mode, instruction = null) => {
        if (!chapter) {
            alert('请先选择章节');
            return;
        }
        const chapterKey = String(chapter);
        setAiLockedChapter(chapterKey);
        setManualContentByChapter((prev) => {
            const next = { ...(prev || {}) };
            if (next[chapterKey] === undefined) {
                next[chapterKey] = manualContent;
            }
            return next;
        });

        stopStreaming();
        clearDiffReview();
        serverStreamActiveRef.current = false;
        serverStreamUsedRef.current = false;
        setStatus('starting');
        setIsGenerating(true);
        setContextDebugByChapter((prev) => ({ ...(prev || {}), [chapterKey]: null }));
        setProgressEventsByChapter((prev) => ({ ...(prev || {}), [chapterKey]: [] }));

        setAgentMode('create');
        appendProgressEvent({ stage: 'session_start', message: '正在准备上下文…' }, chapterKey);

        try {
            const payload = {
                chapter: String(chapter),
                chapter_title: chapterInfo.chapter_title || `章节 ${chapter}`,
                chapter_goal: instruction || 'Auto-generation based on context',
                target_word_count: 3000
            };

            const resp = await sessionAPI.start(projectId, payload);
            const result = resp.data;

            if (!result.success) {
                throw new Error(result.error || '会话启动失败');
            }
            if (result.status === 'waiting_user_input' && result.questions?.length) {
                if (result.scene_brief) {
                    setSceneBrief(result.scene_brief);
                    appendProgressEvent({ stage: 'scene_brief', message: '场景简报已生成（可展开查看）', payload: result.scene_brief }, chapterKey);
                }
                setContextDebugByChapter((prev) => ({ ...(prev || {}), [chapterKey]: result.context_debug || null }));
                setPreWriteQuestions(result.questions);
                setPendingStartPayload(payload);
                setShowPreWriteDialog(true);
                setStatus('waiting_user_input');
                setIsGenerating(false);
                return;
            }

            if (result.scene_brief) {
                setSceneBrief(result.scene_brief);
                appendProgressEvent({ stage: 'scene_brief', message: '场景简报已生成（可展开查看）', payload: result.scene_brief }, chapterKey);
            }
            setContextDebugByChapter((prev) => ({ ...(prev || {}), [chapterKey]: result.context_debug || null }));

            if (result.draft_v1) {
                setDraftV1(result.draft_v1);
            }

            const finalDraft = result.draft_v2 || result.draft_v1;
            const shouldUseHttpDraft = !serverStreamActiveRef.current && !serverStreamUsedRef.current;
            if (finalDraft && shouldUseHttpDraft) {
                setCurrentDraft(finalDraft);
                setCurrentDraftVersion(result.draft_v2 ? 'v2' : 'v1');
                startStreamingDraft(finalDraft.content || '', { chapterKey });
            } else if (shouldUseHttpDraft) {
                setIsGenerating(false);
            }

            if (result.proposals) {
                setProposals(result.proposals);
            }

            setStatus('waiting_feedback');
            if (!serverStreamActiveRef.current && !serverStreamUsedRef.current) {
                addMessage('assistant', '草稿已生成，可继续反馈或手动编辑。', chapterKey);
            }
        } catch (e) {
            addMessage('error', '启动失败: ' + e.message, chapterKey);
            setStatus('idle');
            setIsGenerating(false);
        }
    };

    const handlePreWriteConfirm = async (answers) => {
        if (!pendingStartPayload) return;
        const startPayload = pendingStartPayload;
        const chapterKey = startPayload?.chapter ? String(startPayload.chapter) : activeChapterKey;
        if (chapterKey && chapterKey !== NO_CHAPTER_KEY) {
            setAiLockedChapter(chapterKey);
        }
        setShowPreWriteDialog(false);
        stopStreaming();
        clearDiffReview();
        serverStreamActiveRef.current = false;
        serverStreamUsedRef.current = false;
        setIsGenerating(true);

        try {
            const resp = await sessionAPI.answerQuestions(projectId, {
                ...startPayload,
                answers
            });
            const result = resp.data;

            if (!result.success) {
                throw new Error(result.error || '回答问题失败');
            }

            if (result.status === 'waiting_user_input' && result.questions?.length) {
                setContextDebugByChapter((prev) => ({ ...(prev || {}), [chapterKey]: result.context_debug || null }));
                if (result.scene_brief) {
                    setSceneBrief(result.scene_brief);
                    appendProgressEvent({ stage: 'scene_brief', message: '场景简报已生成（可展开查看）', payload: result.scene_brief }, chapterKey);
                }
                setPreWriteQuestions(result.questions);
                setPendingStartPayload(startPayload);
                setShowPreWriteDialog(true);
                setStatus('waiting_user_input');
                setIsGenerating(false);
                return;
            }

            if (result.scene_brief) {
                setSceneBrief(result.scene_brief);
                appendProgressEvent({ stage: 'scene_brief', message: '场景简报已生成（可展开查看）', payload: result.scene_brief }, chapterKey);
            }
            setContextDebugByChapter((prev) => ({ ...(prev || {}), [chapterKey]: result.context_debug || null }));
            if (result.draft_v1) {
                setDraftV1(result.draft_v1);
            }

            const finalDraft = result.draft_v2 || result.draft_v1;
            const shouldUseHttpDraft = !serverStreamActiveRef.current && !serverStreamUsedRef.current;
            if (finalDraft && shouldUseHttpDraft) {
                setCurrentDraft(finalDraft);
                setCurrentDraftVersion(result.draft_v2 ? 'v2' : 'v1');
                startStreamingDraft(finalDraft.content || '', { chapterKey });
            } else if (shouldUseHttpDraft) {
                setIsGenerating(false);
            }

            if (result.proposals) {
                setProposals(result.proposals);
            }

            setStatus('waiting_feedback');
            if (!serverStreamActiveRef.current && !serverStreamUsedRef.current) {
                addMessage('assistant', '草稿已生成，可继续反馈或手动编辑。', chapterKey);
            }
            setPendingStartPayload(null);
        } catch (e) {
            addMessage('error', '生成失败: ' + e.message, chapterKey);
            setStatus('idle');
            setIsGenerating(false);
        }
    };

    const handlePreWriteSkip = () => {
        handlePreWriteConfirm([]);
    };

    const handleSceneBrief = (data, chapterOverride = null) => {
        setSceneBrief(data);
        appendProgressEvent({ stage: 'scene_brief', message: '场景简报已生成（可展开查看）', payload: data }, chapterOverride);
    };

    const handleDraftV1 = (data, chapterOverride = null) => {
        if (serverStreamActiveRef.current || serverStreamUsedRef.current) {
            return;
        }
        setDraftV1(data);
        clearDiffReview();
        const chapterKey = chapterOverride ? String(chapterOverride) : activeChapterKeyRef.current;
        if (chapterKey && chapterKey !== NO_CHAPTER_KEY) {
            setAiLockedChapter(chapterKey);
        }
        startStreamingDraft(data.content || '', {
            chapterKey,
        });
        setStatus('waiting_feedback');
        addMessage('assistant', '草稿已生成，可继续反馈或手动编辑。', chapterOverride);
    };

    const handleFinalDraft = (data, chapterOverride = null) => {
        if (serverStreamActiveRef.current || serverStreamUsedRef.current) {
            return;
        }
        setCurrentDraft(data);
        clearDiffReview();
        const chapterKey = chapterOverride ? String(chapterOverride) : activeChapterKeyRef.current;
        if (chapterKey && chapterKey !== NO_CHAPTER_KEY) {
            setAiLockedChapter(chapterKey);
        }
        startStreamingDraft(data.content || '', {
            chapterKey,
        });
        setStatus('completed');
        addMessage('assistant', '终稿已完成。', chapterOverride);
    };

    const handleSubmitFeedback = async (feedbackOverride) => {
        const textToSubmit = typeof feedbackOverride === 'string' ? feedbackOverride : feedback;
        if (!textToSubmit?.trim()) return;

        try {
            const normalizeLineEndings = (text) => String(text || '').replace(/\r\n/g, '\n');
            const baseContent = normalizeLineEndings(manualContent);
            const chapterKey = chapterInfo.chapter ? String(chapterInfo.chapter) : activeChapterKey;
            if (chapterKey && chapterKey !== NO_CHAPTER_KEY) {
                setAiLockedChapter(chapterKey);
            }
            setIsGenerating(true);
            setStatus('editing');

            setAgentMode('edit');

            stopStreaming();
            clearDiffReview();
            lastFeedbackRef.current = textToSubmit;

            addMessage('user', `修改指令：${textToSubmit}`);
            appendProgressEvent({ stage: 'edit_suggest', message: '正在生成差异修改建议…' });
            setFeedback('');

            const payload = {
                chapter: chapterInfo.chapter ? String(chapterInfo.chapter) : null,
                content: baseContent,
                instruction: textToSubmit,
                context_mode: editContextMode,
            };

            if (editScope === 'selection' && attachedSelection?.text?.trim()) {
                const baseSelection = attachedSelection?.text?.trim() ? attachedSelection : null;
                if (baseSelection) {
                    const selectionText = String(baseSelection.text || '');
                    const selectionStart = Math.max(0, Math.min(Number(baseSelection.start || 0), baseContent.length));
                    const selectionEnd = Math.max(0, Math.min(Number(baseSelection.end || 0), baseContent.length));
                    payload.selection_text = selectionText;
                    payload.selection_start = Math.min(selectionStart, selectionEnd);
                    payload.selection_end = Math.max(selectionStart, selectionEnd);
                }
            }

            const resp = await sessionAPI.suggestEdit(projectId, payload);

            const result = resp.data;
            if (result.success) {
                let nextContent = normalizeLineEndings(result.revised_content);
                const tailFix = stabilizeRevisionTail(baseContent, nextContent, textToSubmit);
                if (tailFix.applied) {
                    nextContent = normalizeLineEndings(tailFix.text);
                    addMessage('system', '检测到修改建议疑似截断，已自动补齐原文末尾，请检查差异。');
                }

                const diff = buildLineDiff(baseContent, nextContent, { contextLines: 2 });
                const hasChanges = Boolean((diff.stats?.additions || 0) + (diff.stats?.deletions || 0));

                if (!hasChanges) {
                    throw new Error('未能生成可应用的差异修改：请复制粘贴要修改的原句/段落，或使用“选区编辑”进行精确定位。');
                }

                appendProgressEvent({
                    stage: 'edit_suggest_done',
                    message: `差异修改建议已生成（${diff.stats.additions || 0} 新增 / ${diff.stats.deletions || 0} 删除）`
                });

                const hunksWithReason = (diff.hunks || []).map((hunk) => ({
                    ...hunk,
                    reason: lastFeedbackRef.current || '根据用户指令进行调整'
                }));
                const initialDecisions = hunksWithReason.reduce((acc, hunk) => {
                    acc[hunk.id] = 'accepted';
                    return acc;
                }, {});
                setDiffDecisions(initialDecisions);
                setDiffReview({
                    ...diff,
                    hunks: hunksWithReason,
                    originalContent: baseContent,
                    revisedContent: nextContent,
                    chapterKey,
                });
                setStatus('waiting_feedback');
                addMessage('assistant', '已生成差异修改建议：可查看差异并选择“接受”或“撤销”。');
            } else {
                throw new Error(result.error || 'Edit failed');
            }

            setIsGenerating(false);
        } catch (e) {
            addMessage('error', '编辑失败: ' + e.message);
            setIsGenerating(false);
            setStatus('waiting_feedback');
        }
    };

    const handleAcceptAllDiff = () => {
        if (!diffReview) return;
        const nextContent = diffReview.revisedContent || '';
        if ((loadedContent ?? '') !== nextContent) {
            dispatch({ type: 'SET_UNSAVED' });
        }
        setManualContent(nextContent);
        if (diffReview.chapterKey) {
            const key = String(diffReview.chapterKey);
            setManualContentByChapter((prev) => ({ ...(prev || {}), [key]: nextContent }));
        }
        dispatch({ type: 'SET_WORD_COUNT', payload: countChars(nextContent) });
        dispatch({ type: 'SET_SELECTION_COUNT', payload: 0 });
        clearDiffReview();
    };

    const handleRejectAllDiff = () => {
        if (!diffReview) return;
        const nextContent = diffReview.originalContent || '';
        if ((loadedContent ?? '') !== nextContent) {
            dispatch({ type: 'SET_UNSAVED' });
        }
        setManualContent(nextContent);
        if (diffReview.chapterKey) {
            const key = String(diffReview.chapterKey);
            setManualContentByChapter((prev) => ({ ...(prev || {}), [key]: nextContent }));
        }
        dispatch({ type: 'SET_WORD_COUNT', payload: countChars(nextContent) });
        dispatch({ type: 'SET_SELECTION_COUNT', payload: 0 });
        clearDiffReview();
    };

    const handleAcceptDiffHunk = (hunkId) => {
        setDiffDecisions((prev) => {
            const next = { ...(prev || {}) };
            const current = next[hunkId];
            next[hunkId] = current === 'accepted' ? 'pending' : 'accepted';
            return next;
        });
    };

    const handleRejectDiffHunk = (hunkId) => {
        setDiffDecisions((prev) => {
            const next = { ...(prev || {}) };
            const current = next[hunkId];
            next[hunkId] = current === 'rejected' ? 'pending' : 'rejected';
            return next;
        });
    };

    const handleApplySelectedDiff = () => {
        if (!diffReview) return;
        const originalLines = diffReview.originalLines || (diffReview.originalContent || '').split('\n');
        const ops = diffReview.ops || [];
        const hasDecisions = Object.keys(diffDecisions || {}).length > 0;
        const nextContent = hasDecisions
            ? applyDiffOpsWithDecisions(originalLines, ops, diffDecisions)
            : (diffReview.revisedContent || '');
        if ((loadedContent ?? '') !== nextContent) {
            dispatch({ type: 'SET_UNSAVED' });
        }
        setManualContent(nextContent);
        if (diffReview.chapterKey) {
            const key = String(diffReview.chapterKey);
            setManualContentByChapter((prev) => ({ ...(prev || {}), [key]: nextContent }));
        }
        dispatch({ type: 'SET_WORD_COUNT', payload: countChars(nextContent) });
        dispatch({ type: 'SET_SELECTION_COUNT', payload: 0 });
        clearDiffReview();
    };

    const saveDraftContent = async () => {
        if (!chapterInfo.chapter) return { success: false };
        const trimmedTitle = String(chapterInfo.chapter_title || '').trim();
        const payload = { content: manualContent };
        if (trimmedTitle) {
            payload.title = trimmedTitle;
        }
        const resp = await draftsAPI.updateContent(projectId, chapterInfo.chapter, payload);
        if (resp.data?.success) {
            const normalizedChapter = resp.data?.chapter || chapterInfo.chapter;
            if (normalizedChapter && normalizedChapter !== chapterInfo.chapter) {
                setChapterInfo((prev) => ({ ...prev, chapter: normalizedChapter }));
                dispatch({ type: 'SET_ACTIVE_DOCUMENT', payload: { type: 'chapter', id: normalizedChapter } });
                await loadChapters();
            }
            if (typeof resp.data?.title === 'string' && resp.data.title.trim()) {
                setChapterInfo((prev) => ({ ...prev, chapter_title: resp.data.title }));
            }
            dispatch({ type: 'SET_SAVED' });
            mutateChapter(manualContent, false);
        }
        return resp.data;
    };

    const handleManualSave = async () => {
        if (!chapterInfo.chapter) return;
        setIsSaving(true);
        try {
            const result = await saveDraftContent();
            if (result?.success) {
                addMessage('system', '\u8349\u7a3f\u5df2\u4fdd\u5b58');
            }
        } catch (e) {
            addMessage('error', '\u4fdd\u5b58\u5931\u8d25: ' + e.message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleAnalyzeAndSave = async () => {
        if (!chapterInfo.chapter) return;
        setAnalysisLoading(true);
        try {
            const saved = await saveDraftContent();
            if (!saved?.success) {
                throw new Error(saved?.message || '\u4fdd\u5b58\u5931\u8d25');
            }
            const normalizedChapter = saved?.chapter || chapterInfo.chapter;
            const resp = await sessionAPI.analyze(projectId, {
                chapter: normalizedChapter,
                content: manualContent,
                chapter_title: chapterInfo.chapter_title || '',
            });
            if (resp.data?.success) {
                setAnalysisItems([{ chapter: normalizedChapter, analysis: resp.data.analysis || {} }]);
                setAnalysisDialogOpen(true);
                addMessage('system', '\u5206\u6790\u5b8c\u6210，\u8bf7\u786e\u8ba4\u5e76\u4fdd\u5b58\u3002');
            } else {
                throw new Error(resp.data?.error || '\u5206\u6790\u5931\u8d25');
            }
        } catch (e) {
            addMessage('error', '\u5206\u6790\u5931\u8d25: ' + e.message);
        } finally {
            setAnalysisLoading(false);
        }
    };

    const handleSaveAnalysis = async (payload) => {
        setAnalysisSaving(true);
        try {
            if (Array.isArray(payload)) {
                const resp = await sessionAPI.saveAnalysisBatch(projectId, {
                    items: payload,
                    overwrite: true,
                });
                if (!resp.data?.success) {
                    throw new Error(resp.data?.error || '\u5206\u6790\u5931\u8d25');
                }
            } else if (chapterInfo.chapter) {
                const resp = await sessionAPI.saveAnalysis(projectId, {
                    chapter: chapterInfo.chapter,
                    analysis: payload,
                    overwrite: true,
                });
                if (!resp.data?.success) {
                    throw new Error(resp.data?.error || '\u5206\u6790\u5931\u8d25');
                }
            }
            addMessage('system', '\u5206\u6790\u4fdd\u5b58\u5b8c\u6210');
            setAnalysisDialogOpen(false);
            setAnalysisItems([]);
        } catch (e) {
            addMessage('error', '\u4fdd\u5b58\u5931\u8d25: ' + e.message);
        } finally {
            setAnalysisSaving(false);
        }
    };

    // Phase 4.3: Handle user answer for AskUser
    // Card Handlers
    const handleCardSave = async () => {
        if (!activeCard) return;
        setIsSaving(true);
        try {
            const name = (cardForm.name || '').trim();
            if (!name) {
                throw new Error('卡片名称不能为空');
            }
            const stars = normalizeStars(cardForm.stars);
            const aliases = parseListInput(cardForm.aliases);
            if (activeCard.type === 'character') {
                const payload = {
                    name,
                    description: cardForm.description || '',
                    aliases,
                    stars
                };
                if (activeCard.isNew || !activeCard.originalName) {
                    await cardsAPI.createCharacter(projectId, payload);
                } else if (activeCard.originalName !== name) {
                    await cardsAPI.createCharacter(projectId, payload);
                    await cardsAPI.deleteCharacter(projectId, activeCard.originalName);
                } else {
                    await cardsAPI.updateCharacter(projectId, activeCard.originalName, payload);
                }
            } else {
                const rules = parseListInput(cardForm.rules);
                const immutableValue =
                    cardForm.immutable === 'true' ? true : cardForm.immutable === 'false' ? false : undefined;
                const payload = {
                    name,
                    description: cardForm.description || '',
                    aliases,
                    category: (cardForm.category || '').trim(),
                    rules,
                    stars
                };
                if (immutableValue !== undefined) {
                    payload.immutable = immutableValue;
                }
                if (activeCard.isNew || !activeCard.originalName) {
                    await cardsAPI.createWorld(projectId, payload);
                } else if (activeCard.originalName !== name) {
                    await cardsAPI.createWorld(projectId, payload);
                    await cardsAPI.deleteWorld(projectId, activeCard.originalName);
                } else {
                    await cardsAPI.updateWorld(projectId, activeCard.originalName, payload);
                }
            }
            try {
                const refreshed = activeCard.type === 'character'
                    ? await cardsAPI.getCharacter(projectId, name)
                    : await cardsAPI.getWorld(projectId, name);
                const refreshedData = refreshed?.data;
                if (refreshedData?.name) {
                    setActiveCard({
                        ...refreshedData,
                        type: activeCard.type,
                        isNew: false,
                        originalName: refreshedData.name,
                    });
                    setCardForm({
                        name: refreshedData.name || '',
                        description: refreshedData.description || '',
                        aliases: formatListInput(refreshedData.aliases),
                        stars: normalizeStars(refreshedData.stars),
                        category: refreshedData.category || '',
                        rules: formatRulesInput(refreshedData.rules),
                        immutable: refreshedData.immutable === true ? 'true' : refreshedData.immutable === false ? 'false' : 'unset'
                    });
                }
            } catch (error) {
                logger.error('Failed to refresh card data', error);
            }
            addMessage('system', '卡片已更新');
            dispatch({ type: 'SET_SAVED' });
        } catch (e) {
            const detail = e?.response?.data?.detail || e?.response?.data?.error;
            addMessage('error', '卡片保存失败: ' + (detail || e.message));
        } finally {
            setIsSaving(false);
        }
    };

    const renderMainContent = () => {
        if (state.activeActivity === 'fanfiction') {
            return (
                <FanfictionView
                    embedded
                    onClose={() => dispatch({ type: 'SET_ACTIVE_PANEL', payload: 'explorer' })}
                />
            );
        }
        return (
            <AnimatePresence mode="wait">
                {status === 'card_editing' && activeCard ? (
                    <motion.div
                        key="card-editor"
                        initial={{ opacity: 0, scale: 0.98, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98, y: -10 }}
                        transition={{ duration: 0.3, ease: "easeOut" }}
                        className="h-full flex flex-col max-w-3xl mx-auto w-full pt-4"
                    >
                        <div className="flex items-center justify-between mb-6 pb-4 border-b border-border">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-primary/10 rounded-lg text-primary">
                                    {activeCard.type === 'character' ? <div className="i-lucide-user" /> : <div className="i-lucide-globe" />}
                                    {activeCard.type === 'character' ? '👤' : '🌍'}
                                </div>
                                <div>
                                    <p className="text-xs text-ink-400 font-mono uppercase tracking-wider">{activeCard.type === 'character' ? '角色卡片' : '世界卡片'}</p>
                                </div>
                            </div>
                            <button
                                onClick={() => {
                                    setStatus('idle');
                                    setActiveCard(null);
                                }}
                                className="p-2 hover:bg-ink-100 rounded-lg transition-colors text-ink-400 hover:text-ink-700"
                                title="关闭卡片编辑"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="space-y-6 flex-1 overflow-y-auto px-1 pb-20">
                            {/* Common: Name */}
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-ink-500 tracking-wider">名称</label>
                                <Input
                                    value={cardForm.name}
                                    onChange={e => setCardForm(prev => ({ ...prev, name: e.target.value }))}
                                    className="font-serif text-lg bg-[var(--vscode-input-bg)] font-bold"
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="text-xs font-bold text-ink-500 tracking-wider">星级</label>
                                <select
                                    value={cardForm.stars}
                                    onChange={e => setCardForm(prev => ({ ...prev, stars: normalizeStars(e.target.value) }))}
                                    className="w-full h-10 px-3 rounded-[6px] border border-[var(--vscode-input-border)] bg-[var(--vscode-input-bg)] text-sm focus:ring-1 focus:ring-[var(--vscode-focus-border)]"
                                >
                                    <option value={3}>三星（必须关注）</option>
                                    <option value={2}>二星（重要）</option>
                                    <option value={1}>一星（可选）</option>
                                </select>
                            </div>

                            <div className="space-y-1">
                                <label className="text-xs font-bold text-ink-500 tracking-wider">别名</label>
                                <Input
                                    value={cardForm.aliases || ''}
                                    onChange={e => setCardForm(prev => ({ ...prev, aliases: e.target.value }))}
                                    placeholder="多个别名用逗号分隔"
                                    className="bg-[var(--vscode-input-bg)]"
                                />
                            </div>

                            {activeCard.type === 'world' && (
                                <>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-ink-500 tracking-wider">类别</label>
                                        <Input
                                            value={cardForm.category || ''}
                                            onChange={e => setCardForm(prev => ({ ...prev, category: e.target.value }))}
                                            placeholder="世界元素类别"
                                            className="bg-[var(--vscode-input-bg)]"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-ink-500 tracking-wider">规则</label>
                                        <textarea
                                            className="w-full min-h-[140px] p-3 rounded-[6px] border border-[var(--vscode-input-border)] bg-[var(--vscode-input-bg)] text-sm focus:ring-1 focus:ring-[var(--vscode-focus-border)] resize-none overflow-hidden"
                                            value={cardForm.rules || ''}
                                            onChange={e => {
                                                setCardForm(prev => ({ ...prev, rules: e.target.value }));
                                                e.target.style.height = 'auto';
                                                e.target.style.height = e.target.scrollHeight + 'px';
                                            }}
                                            onFocus={e => {
                                                e.target.style.height = 'auto';
                                                e.target.style.height = e.target.scrollHeight + 'px';
                                            }}
                                            placeholder="每行一条规则"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-ink-500 tracking-wider">不可变</label>
                                        <select
                                            value={cardForm.immutable}
                                            onChange={e => setCardForm(prev => ({ ...prev, immutable: e.target.value }))}
                                            className="w-full h-10 px-3 rounded-[6px] border border-[var(--vscode-input-border)] bg-[var(--vscode-input-bg)] text-sm focus:ring-1 focus:ring-[var(--vscode-focus-border)]"
                                        >
                                            <option value="unset">未设置</option>
                                            <option value="true">不可变</option>
                                            <option value="false">可变</option>
                                        </select>
                                    </div>
                                </>
                            )}

                            {/* Card Description */}
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-ink-500 tracking-wider">描述</label>
                                <textarea
                                    className="w-full min-h-[200px] p-3 rounded-[6px] border border-[var(--vscode-input-border)] bg-[var(--vscode-input-bg)] text-sm focus:ring-1 focus:ring-[var(--vscode-focus-border)] resize-none overflow-hidden"
                                    value={cardForm.description || ''}
                                    onChange={e => {
                                        setCardForm(prev => ({ ...prev, description: e.target.value }));
                                        e.target.style.height = 'auto';
                                        e.target.style.height = e.target.scrollHeight + 'px';
                                    }}
                                    onFocus={e => {
                                        e.target.style.height = 'auto';
                                        e.target.style.height = e.target.scrollHeight + 'px';
                                    }}
                                    placeholder="请简要描述"
                                />
                            </div>

                        </div>
                    </motion.div>
                ) : !chapterInfo.chapter ? (
                    <motion.div
                        key="empty-state"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="h-[60vh] flex items-center justify-center"
                    >
                        <div className="text-center">
                            <div className="flex flex-col items-center gap-2 mb-4">
                                <span className="brand-logo text-4xl text-ink-900/40">文枢</span>
                            </div>
                            <p className="text-sm text-ink-500">
                                请在左侧选择资源，或使用快捷键 Cmd+B 切换面板
                            </p>
                        </div>
                    </motion.div>
                ) : (
                    <motion.div
                        key="chapter-editor"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.3 }}
                        className="h-full flex flex-col relative"
                    >
                        <div className="mb-4 pb-3 border-b border-border flex flex-wrap items-center gap-3">
                            <span className="text-[11px] font-mono text-ink-500 uppercase tracking-wider">{chapterInfo.chapter}</span>
                            <input
                                className="flex-1 min-w-[200px] bg-transparent text-2xl font-serif font-bold text-ink-900 outline-none placeholder:text-ink-300"
                                value={chapterInfo.chapter_title || ''}
                                onChange={(e) => {
                                    setChapterInfo((prev) => ({ ...prev, chapter_title: e.target.value }));
                                    dispatch({ type: 'SET_UNSAVED' });
                                }}
                                placeholder="请输入章节标题"
                                disabled={!chapterInfo.chapter}
                            />
                        </div>
                        <div className="flex-1 overflow-hidden bg-[var(--vscode-bg)] border-t border-[var(--vscode-sidebar-border)]">
                            {isDiffReviewForActiveChapter ? (
                                <DiffReviewView
                                    ops={diffReview.ops}
                                    hunks={diffReview.hunks}
                                    stats={diffReview.stats}
                                    decisions={diffDecisions}
                                    onAcceptHunk={handleAcceptDiffHunk}
                                    onRejectHunk={handleRejectDiffHunk}
                                    originalVersion="当前正文"
                                    revisedVersion="修改建议"
                                />
                            ) : isStreamingForActiveChapter ? (
                                <StreamingDraftView
                                    content={manualContent}
                                    active={isStreamingForActiveChapter}
                                    className="h-full"
                                />
                            ) : (
                                <textarea
                                    className="h-full w-full resize-none border-none outline-none bg-transparent p-6 text-base font-serif text-ink-900 leading-relaxed focus:ring-0 placeholder:text-ink-300 overflow-y-auto editor-scrollbar"
                                    value={manualContent}
                                    onChange={(e) => {
                                        const nextValue = e.target.value;
                                        setManualContent(nextValue);
                                        if (chapterInfo.chapter) {
                                            const key = String(chapterInfo.chapter);
                                            setManualContentByChapter((prev) => ({ ...(prev || {}), [key]: nextValue }));
                                        }
                                        dispatch({ type: 'SET_WORD_COUNT', payload: countChars(nextValue) });
                                        const stats = getSelectionStats(nextValue, e.target.selectionStart, e.target.selectionEnd);
                                        dispatch({ type: 'SET_SELECTION_COUNT', payload: stats.selectionCount });
                                        setSelectionInfo({
                                            start: stats.selectionStart,
                                            end: stats.selectionEnd,
                                            text: stats.selectionText || '',
                                        });
                                        const lines = stats.cursorText.split('\n');
                                        dispatch({
                                            type: 'SET_CURSOR_POSITION',
                                            payload: {
                                                line: lines.length,
                                                column: lines[lines.length - 1].length + 1
                                            }
                                        });
                                        dispatch({ type: 'SET_UNSAVED' });
                                    }}
                                    onSelect={(e) => {
                                        const stats = getSelectionStats(e.target.value, e.target.selectionStart, e.target.selectionEnd);
                                        dispatch({ type: 'SET_SELECTION_COUNT', payload: stats.selectionCount });
                                        setSelectionInfo({
                                            start: stats.selectionStart,
                                            end: stats.selectionEnd,
                                            text: stats.selectionText || '',
                                        });
                                        const lines = stats.cursorText.split('\n');
                                        dispatch({
                                            type: 'SET_CURSOR_POSITION',
                                            payload: {
                                                line: lines.length,
                                                column: lines[lines.length - 1].length + 1
                                            }
                                        });
                                    }}
                                    placeholder="开始写作..."
                                    disabled={!chapterInfo.chapter || lockedOnActiveChapter}
                                    spellCheck={false}
                                />
                            )}
                        </div>

                    </motion.div>
                )}
            </AnimatePresence>
        );
    };

    const rightPanelContent = (
        <AgentsPanel traceEvents={traceEvents} agentTraces={agentTraces}>
            <AgentStatusPanel
                mode={agentMode}
                onModeChange={setAgentMode}
                createDisabled={!canUseWriter}
                inputDisabled={agentBusy && String(aiLockedChapter || '') !== activeChapterKey}
                inputDisabledReason={
                    agentBusy && String(aiLockedChapter || '') !== activeChapterKey
                        ? `AI 正在撰写第 ${String(aiLockedChapter)} 章：右侧对话已锁定，请切换回该章节继续。`
                        : ''
                }
                selectionCandidateSummary={
                    agentMode === 'edit' && selectionInfo?.text?.trim()
                        ? `已选中 ${countChars(selectionInfo.text)} 字（未添加）`
                        : ''
                }
                selectionAttachedSummary={
                    agentMode === 'edit' && attachedSelection?.text?.trim()
                        ? `已添加选区 ${countChars(attachedSelection.text)} 字`
                        : ''
                }
                selectionCandidateDifferent={
                    Boolean(selectionInfo?.text?.trim()) &&
                    Boolean(attachedSelection?.text?.trim()) &&
                    (selectionInfo.start !== attachedSelection.start ||
                        selectionInfo.end !== attachedSelection.end ||
                        selectionInfo.text !== attachedSelection.text)
                }
                onAttachSelection={() => {
                    if (!selectionInfo?.text?.trim()) return;
                    setAttachedSelection({
                        start: selectionInfo.start,
                        end: selectionInfo.end,
                        text: selectionInfo.text,
                    });
                    setEditScope('selection');
                }}
                onClearAttachedSelection={() => {
                    setAttachedSelection(null);
                    setEditScope('document');
                }}
                editScope={editScope}
                onEditScopeChange={setEditScope}
                contextDebug={contextDebug}
                progressEvents={progressEvents}
                messages={messages}
                memoryPackStatus={memoryPackStatus}
                activeChapter={agentBusy ? aiLockedChapter : chapterInfo.chapter}
                editContextMode={editContextMode}
                onEditContextModeChange={setEditContextMode}
                diffReview={diffReview && String(diffReview?.chapterKey || '') === agentChapterKey ? diffReview : null}
                diffDecisions={diffDecisions}
                onAcceptAllDiff={handleAcceptAllDiff}
                onRejectAllDiff={handleRejectAllDiff}
                onApplySelectedDiff={handleApplySelectedDiff}
                onSubmit={(text) => {
                    if (!chapterInfo.chapter) {
                        addMessage('system', '请先选择章节。');
                        return;
                    }

                    if (agentMode === 'create') {
                        if (!canUseWriter) {
                            addMessage('system', '正文非空：主笔仅在正文为空时可用，请切换到编辑模式。');
                            setAgentMode('edit');
                            return;
                        }
                        addMessage('user', text);
                        handleStart(chapterInfo.chapter, 'deep', text);
                        return;
                    }

                    handleSubmitFeedback(text);
                }}
            />
        </AgentsPanel>
    );


    
    const saveBusy = isSaving || analysisLoading || analysisSaving;
    const showSaveAction = (chapterInfo.chapter || status === 'card_editing') && !lockedOnActiveChapter;
    const saveAction = showSaveAction ? (
        status === 'card_editing' ? (
            <Button
                onClick={handleCardSave}
                disabled={isSaving}
                className="shadow-sm"
                size="sm"
            >
                {isSaving ? '\u4fdd\u5b58\u4e2d...' : '\u4fdd\u5b58'}
            </Button>
        ) : (
            <SaveMenu
                disabled={!chapterInfo.chapter || saveBusy}
                busy={saveBusy}
                onSaveOnly={handleManualSave}
                onAnalyzeSave={handleAnalyzeAndSave}
            />
        )
    ) : null;

    const titleBarProps = {
        projectName: project?.name,
        rightActions: saveAction,
        // Show Card Name in Title if card editing
        chapterTitle: status === 'card_editing'
            ? cardForm.name
            : (chapterInfo.chapter ? (chapterInfo.chapter_title || `章节 ${chapterInfo.chapter}`) : null),
        aiHint: agentBusy && aiLockedChapter ? `正在撰写第 ${String(aiLockedChapter)} 章` : null,
    };

    return (
        <IDELayout rightPanelContent={rightPanelContent} titleBarProps={titleBarProps}>
            <div className="w-full h-full px-8 py-6">
                {renderMainContent()}
            </div>

            {notice ? (
                <div
                    key={notice.id}
                    className="fixed bottom-4 right-4 z-[60] max-w-[420px] rounded-[6px] border border-[var(--vscode-sidebar-border)] bg-[var(--vscode-input-bg)] px-3 py-2 text-xs text-[var(--vscode-fg)] shadow-md"
                >
                    {notice.text}
                </div>
            ) : null}


            <ChapterCreateDialog
                open={showChapterDialog}
                onClose={() => {
                    setShowChapterDialog(false);
                    dispatch({ type: 'CLOSE_CREATE_CHAPTER_DIALOG' });
                }}
                onConfirm={handleChapterCreate}
                existingChapters={chapters.map(c => ({ id: c, title: '' }))}
                volumes={volumes}
                defaultVolumeId={state.selectedVolumeId || 'V1'}
            />

            <PreWritingQuestionsDialog
                open={showPreWriteDialog}
                questions={preWriteQuestions}
                onConfirm={handlePreWriteConfirm}
                onSkip={handlePreWriteSkip}
            />

            <AnalysisReviewDialog
                open={analysisDialogOpen}
                analyses={analysisItems}
                onCancel={() => {
                    setAnalysisDialogOpen(false);
                    setAnalysisItems([]);
                }}
                onSave={handleSaveAnalysis}
                saving={analysisSaving}
            />

        </IDELayout >
    );
}

/**
 * WritingSession - 写作会话入口
 * 提供 IDE 上下文并渲染主容器。
 */
export default function WritingSession(props) {
    const { projectId } = useParams();
    return (
        <IDEProvider projectId={projectId}>
            <WritingSessionContent {...props} />
        </IDEProvider>
    );
}
