import { useState, useEffect, useRef, useCallback } from 'react';
import useSWR from 'swr';
import { motion, AnimatePresence } from 'framer-motion';
import { useParams, useNavigate } from 'react-router-dom';
import { sessionAPI, createWebSocket, draftsAPI, cardsAPI, projectsAPI, volumesAPI } from '../api';
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
import { buildLineDiff } from '../lib/diffUtils';
import InlineDiffEditor from '../components/ide/InlineDiffEditor';
import SaveMenu from '../components/writing/SaveMenu';
import FanfictionView from './FanfictionView';

// Helper fetcher
const fetchChapterContent = async ([_, projectId, chapter]) => {
    try {
        // 1. Try to get Final Draft
        const resp = await draftsAPI.getFinal(projectId, chapter);
        return resp.data?.content || '';
    } catch (e) {
        // If final not found (404), try to get latest version
        try {
            const versionsResp = await draftsAPI.listVersions(projectId, chapter);
            const versions = versionsResp.data || [];
            if (versions.length > 0) {
                const latestVer = versions[versions.length - 1];
                const draftResp = await draftsAPI.getDraft(projectId, chapter, latestVer);
                return draftResp.data?.content || '';
            }
        } catch (vErr) {
            console.log('No drafts found, starting fresh.');
        }
    }
    return '';
};

const countChars = (text) => (text || '').replace(/\s/g, '').length;

const getSelectionStats = (text, start, end) => {
    const safeText = text || '';
    const safeStart = Math.max(0, Math.min(start || 0, safeText.length));
    const safeEnd = Math.max(0, Math.min(end || 0, safeText.length));
    const selection = safeText.slice(Math.min(safeStart, safeEnd), Math.max(safeStart, safeEnd));
    return {
        selectionCount: countChars(selection),
        cursorText: safeText.slice(0, safeStart)
    };
};

function WritingSessionContent({ isEmbedded = false }) {
    const { projectId } = useParams();
    const navigate = useNavigate();
    const { state, dispatch } = useIDE();

    // 加载项目数据
    const [project, setProject] = useState(null);
    useEffect(() => {
        if (projectId) {
            projectsAPI.get(projectId).then(res => setProject(res.data));
            dispatch({ type: 'SET_PROJECT_ID', payload: projectId });
        }
    }, [projectId, dispatch]);



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
    const [messages, setMessages] = useState([]);
    const [currentDraft, setCurrentDraft] = useState(null);
    const [manualContent, setManualContent] = useState(''); // Textarea content
    const [sceneBrief, setSceneBrief] = useState(null);
    const [draftV1, setDraftV1] = useState(null);
    const [feedback, setFeedback] = useState('');
    const [diffReview, setDiffReview] = useState(null);
    const lastFeedbackRef = useRef('');
    const lastGeneratedRef = useRef(false);
    const streamBufferRef = useRef('');
    const streamTextRef = useRef('');
    const streamFlushRafRef = useRef(null);
    const serverStreamActiveRef = useRef(false);
    const serverStreamUsedRef = useRef(false);

    const [showPreWriteDialog, setShowPreWriteDialog] = useState(false);
    const [preWriteQuestions, setPreWriteQuestions] = useState([]);
    const [pendingStartPayload, setPendingStartPayload] = useState(null);

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


    // Draft version state
    const [currentDraftVersion, setCurrentDraftVersion] = useState('v1');

    // Agent Status State (for AgentStatusPanel)
    const [agentMode, setAgentMode] = useState('create'); // 'create' | 'edit'
    const [archivistStatus, setArchivistStatus] = useState('idle');
    const [writerStatus, setWriterStatus] = useState('idle');
    const [editorStatus, setEditorStatus] = useState('idle');
    const [archivistOutput, setArchivistOutput] = useState(null);

    useEffect(() => {
        if (!projectId) return;

        const wsController = createWebSocket(
            projectId,
            (data) => {
                if (data.type === 'start_ack') addMessage('system', '会话已启动');
                if (data.type === 'stream_start') {
                    stopStreaming();
                    clearDiffReview();
                    serverStreamActiveRef.current = true;
                    serverStreamUsedRef.current = true;
                    streamBufferRef.current = '';
                    streamTextRef.current = '';
                    if (streamFlushRafRef.current) {
                        window.cancelAnimationFrame(streamFlushRafRef.current);
                        streamFlushRafRef.current = null;
                    }
                    lastGeneratedRef.current = true;
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
                    streamBufferRef.current += data.content;
                    if (!streamFlushRafRef.current) {
                        streamFlushRafRef.current = window.requestAnimationFrame(() => {
                            streamTextRef.current += streamBufferRef.current;
                            streamBufferRef.current = '';
                            setManualContent(streamTextRef.current);
                            const current = streamTextRef.current.length;
                            setStreamingState(prev => ({
                                ...prev,
                                current,
                                progress: prev.total ? Math.round((current / prev.total) * 100) : prev.progress
                            }));
                            streamFlushRafRef.current = null;
                        });
                    }
                }
                if (data.type === 'stream_end') {
                    if (streamFlushRafRef.current) {
                        window.cancelAnimationFrame(streamFlushRafRef.current);
                        streamFlushRafRef.current = null;
                    }
                    streamTextRef.current += streamBufferRef.current;
                    streamBufferRef.current = '';
                    const finalText = data.draft?.content || streamTextRef.current;
                    serverStreamActiveRef.current = false;
                    setManualContent(finalText);
                    setStreamingState({
                        active: false,
                        progress: 100,
                        current: finalText.length,
                        total: finalText.length
                    });
                    setIsGenerating(false);
                    dispatch({ type: 'SET_WORD_COUNT', payload: countChars(finalText) });
                    dispatch({ type: 'SET_SELECTION_COUNT', payload: 0 });
                    if (data.draft) {
                        setCurrentDraft(data.draft);
                        setCurrentDraftVersion(data.draft.version || currentDraftVersion);
                    }
                    if (data.proposals) {
                        setProposals(data.proposals);
                    }
                    setStatus('waiting_feedback');
                    addMessage('assistant', '草稿已生成，可继续反馈或手动编辑。');
                }
                if (data.type === 'scene_brief') handleSceneBrief(data.data);
                if (data.type === 'draft_v1') handleDraftV1(data.data);
                if (data.type === 'final_draft') handleFinalDraft(data.data);
                if (data.type === 'error') addMessage('error', data.message);

                // Handle backend status updates (progress)
                if (data.status && data.message) {
                    addMessage('system', `> ${data.message}`);
                }
            },
            {
                onStatus: (status) => {
                    if (wsStatusRef.current !== status) {
                        if (status === 'reconnecting') {
                            addMessage('system', '连接中断，正在重连...');
                        }
                        if (status === 'connected' && wsStatusRef.current === 'reconnecting') {
                            addMessage('system', '连接已恢复');
                        }
                        if (status === 'disconnected') {
                            addMessage('system', '连接已断开');
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
    const [cardForm, setCardForm] = useState({ name: '', description: '' });

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

    // Sync SWR data to manualContent
    useEffect(() => {
        if (loadedContent === undefined || streamingState.active || state.unsavedChanges) {
            return;
        }

        if (lastGeneratedRef.current && manualContent && !(loadedContent || '').trim()) {
            return;
        }

        setManualContent(loadedContent);
        dispatch({ type: 'SET_WORD_COUNT', payload: countChars(loadedContent) });
        dispatch({ type: 'SET_SELECTION_COUNT', payload: 0 });
        lastGeneratedRef.current = false;
        // Only center cursor if we just switched chapters (optional optimization)
        // dispatch({ type: 'SET_CURSOR_POSITION', payload: { line: 1, column: 1 } });
    }, [loadedContent, dispatch, streamingState.active, manualContent, state.unsavedChanges]);


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
            console.error('Failed to load chapters:', e);
        }
    };

    const handleChapterSelect = async (chapter, presetTitle = '') => {
        // Just set the chapter, let SWR handle fetching
        stopStreaming();
        clearDiffReview();
        setChapterInfo({ chapter, chapter_title: presetTitle || '', content: '' }); // content will be filled by SWR
        setStatus('editing');
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
                dispatch({ type: 'SET_ACTIVE_DOCUMENT', payload: { type: 'chapter', id: normalizedChapter } });
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
            addMessage('system', `?? ${normalizedChapter} ???`);
            if (normalizedChapter !== chapterNum) {
                dispatch({ type: 'SET_ACTIVE_DOCUMENT', payload: { type: 'chapter', id: normalizedChapter } });
            }
        } catch (e) {
            addMessage('error', '??????: ' + e.message);
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

    const addMessage = (type, content) => {
        setMessages(prev => [...prev, { type, content, time: new Date() }]);
    };

    const clearDiffReview = useCallback(() => {
        setDiffReview(null);
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

    const startStreamingDraft = useCallback((targetText, options = {}) => {
        const { onComplete } = options;
        stopStreaming();

        const safeText = targetText || '';
        if (!safeText) {
        setManualContent('');
        setIsGenerating(false);
        onComplete?.();
        return;
        }

        setIsGenerating(true);
        const total = safeText.length;
        const charsPerSecond = Math.min(420, Math.max(180, Math.round(total / 3)));
        let index = 0;
        let lastTs = performance.now();
        let rafId = null;

        setManualContent('');
        setStreamingState({
            active: true,
            progress: 0,
            current: 0,
            total
        });
        lastGeneratedRef.current = true;

        const initialBurst = Math.min(total, Math.max(12, Math.floor(total * 0.03)));
        if (initialBurst > 0) {
            index = initialBurst;
            setManualContent(safeText.slice(0, index));
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

            setManualContent(safeText.slice(0, index));
            setStreamingState({
                active: index < total,
                progress: Math.round((index / total) * 100),
                current: index,
                total
            });

            if (index >= total) {
                streamingRef.current = null;
                setIsGenerating(false);
                dispatch({ type: 'SET_WORD_COUNT', payload: countChars(safeText) });
                dispatch({ type: 'SET_SELECTION_COUNT', payload: 0 });
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
    }, [dispatch, stopStreaming]);

    useEffect(() => {
        return () => {
            stopStreaming();
        };
    }, [stopStreaming]);

    // 监听 Context 中的文档选择（章节或卡片）
    useEffect(() => {
        if (!state.activeDocument) return;

        if (state.activeDocument.type === 'chapter' && state.activeDocument.id) {
            stopStreaming();
            clearDiffReview();
            setActiveCard(null); // Clear card state
            const presetTitle = state.activeDocument.data?.title || '';
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
                  description: ''
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
                        description: fullData.description || ''
                    });
                } catch (e) {
                    console.error("Failed to fetch card details", e);
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

        stopStreaming();
        clearDiffReview();
        serverStreamActiveRef.current = false;
        serverStreamUsedRef.current = false;
        setStatus('starting');
        setIsGenerating(true);

        setAgentMode('create');
        setArchivistStatus('working');
        setWriterStatus('idle');
        setEditorStatus('idle');
        setArchivistOutput(null);

        addMessage('system', '档案员正在整理设定...');

        try {
            const payload = {
                chapter: String(chapter),
                chapter_title: chapterInfo.chapter_title || `Chapter ${chapter}`,
                chapter_goal: instruction || 'Auto-generation based on context',
                target_word_count: 3000
            };

            const resp = await sessionAPI.start(projectId, payload);
            const result = resp.data;

            if (!result.success) {
                setArchivistStatus('error');
                throw new Error(result.error || '会话启动失败');
            }

            setArchivistStatus('done');
            if (result.status === 'waiting_user_input' && result.questions?.length) {
                if (result.scene_brief) {
                    setSceneBrief(result.scene_brief);
                    setArchivistOutput(result.scene_brief);
                }
                setWriterStatus('idle');
                setEditorStatus('idle');
                setPreWriteQuestions(result.questions);
                setPendingStartPayload(payload);
                setShowPreWriteDialog(true);
                setStatus('waiting_user_input');
                setIsGenerating(false);
                return;
            }

            setWriterStatus('done');
            setEditorStatus('idle');

            if (result.scene_brief) {
                setSceneBrief(result.scene_brief);
                setArchivistOutput(result.scene_brief);
            }

            if (result.draft_v1) {
                setDraftV1(result.draft_v1);
            }

            const finalDraft = result.draft_v2 || result.draft_v1;
            const shouldUseHttpDraft = !serverStreamActiveRef.current && !serverStreamUsedRef.current;
            if (finalDraft && shouldUseHttpDraft) {
                setCurrentDraft(finalDraft);
                setCurrentDraftVersion(result.draft_v2 ? 'v2' : 'v1');
                startStreamingDraft(finalDraft.content || '');
            } else if (shouldUseHttpDraft) {
                setIsGenerating(false);
            }

            if (result.proposals) {
                setProposals(result.proposals);
            }

            setStatus('waiting_feedback');
            if (!serverStreamActiveRef.current && !serverStreamUsedRef.current) {
                addMessage('assistant', '草稿已生成，可继续反馈或手动编辑。');
            }
        } catch (e) {
            addMessage('error', '启动失败: ' + e.message);
            setStatus('idle');
            setIsGenerating(false);
            setArchivistStatus('error');
        }
    };

    const handlePreWriteConfirm = async (answers) => {
        if (!pendingStartPayload) return;
        setShowPreWriteDialog(false);
        stopStreaming();
        clearDiffReview();
        serverStreamActiveRef.current = false;
        serverStreamUsedRef.current = false;
        setIsGenerating(true);
        setWriterStatus('working');
        setEditorStatus('idle');

        try {
            const resp = await sessionAPI.answerQuestions(projectId, {
                ...pendingStartPayload,
                answers
            });
            const result = resp.data;

            if (!result.success) {
                setWriterStatus('error');
                throw new Error(result.error || '回答问题失败');
            }

            setWriterStatus('done');
            setEditorStatus('idle');

            if (result.scene_brief) {
                setSceneBrief(result.scene_brief);
                setArchivistOutput(result.scene_brief);
            }
            if (result.draft_v1) {
                setDraftV1(result.draft_v1);
            }

            const finalDraft = result.draft_v2 || result.draft_v1;
            const shouldUseHttpDraft = !serverStreamActiveRef.current && !serverStreamUsedRef.current;
            if (finalDraft && shouldUseHttpDraft) {
                setCurrentDraft(finalDraft);
                setCurrentDraftVersion(result.draft_v2 ? 'v2' : 'v1');
                startStreamingDraft(finalDraft.content || '');
            } else if (shouldUseHttpDraft) {
                setIsGenerating(false);
            }

            if (result.proposals) {
                setProposals(result.proposals);
            }

            setStatus('waiting_feedback');
            if (!serverStreamActiveRef.current && !serverStreamUsedRef.current) {
                addMessage('assistant', '草稿已生成，可继续反馈或手动编辑。');
            }
        } catch (e) {
            addMessage('error', '生成失败: ' + e.message);
            setStatus('idle');
            setIsGenerating(false);
        } finally {
            setPendingStartPayload(null);
        }
    };

    const handlePreWriteSkip = () => {
        handlePreWriteConfirm([]);
    };

    const handleSceneBrief = (data) => {
        setSceneBrief(data);
        addMessage('assistant', '场景简报已生成');
    };

    const handleDraftV1 = (data) => {
        if (serverStreamActiveRef.current || serverStreamUsedRef.current) {
            return;
        }
        setDraftV1(data);
        clearDiffReview();
        startStreamingDraft(data.content || '');
        setStatus('waiting_feedback');
        addMessage('assistant', '草稿已生成，可继续反馈或手动编辑。');
    };

    const handleFinalDraft = (data) => {
        if (serverStreamActiveRef.current || serverStreamUsedRef.current) {
            return;
        }
        setCurrentDraft(data);
        clearDiffReview();
        startStreamingDraft(data.content || '');
        setStatus('completed');
        addMessage('assistant', '终稿已完成。');
    };

    const handleSubmitFeedback = async (feedbackOverride) => {
        const textToSubmit = typeof feedbackOverride === 'string' ? feedbackOverride : feedback;
        if (!textToSubmit?.trim()) return;

        try {
            const baseContent = manualContent || '';
            const baseVersion = currentDraftVersion;
            setIsGenerating(true);
            setStatus('editing');

            setAgentMode('edit');
            setEditorStatus('working');

            stopStreaming();
            clearDiffReview();
            lastFeedbackRef.current = textToSubmit;

            addMessage('user', `修改意见：${textToSubmit}`);
            addMessage('system', '编辑处理中...');
            setFeedback('');

            const resp = await sessionAPI.submitFeedback(projectId, {
                chapter: String(chapterInfo.chapter),
                feedback: textToSubmit,
                action: 'revise'
            });

            const result = resp.data;
            if (result.success) {
                setEditorStatus('done');
                if (result.draft) {
                    const nextContent = result.draft.content || '';
                    setCurrentDraft(result.draft);
                    setManualContent(nextContent);

                    if (baseContent && nextContent && baseContent !== nextContent) {
                        const diff = buildLineDiff(baseContent, nextContent, { contextLines: 2 });
                        const hunksWithReason = diff.hunks.map((hunk) => ({
                            ...hunk,
                            reason: lastFeedbackRef.current || '根据用户反馈进行调整'
                        }));
                        const revisedVersion = result.version || currentDraftVersion;
                        setDiffReview({
                            ...diff,
                            hunks: hunksWithReason,
                            originalContent: baseContent,
                            revisedContent: nextContent,
                            originalVersion: baseVersion,
                            revisedVersion
                        });
                    }
                }
                if (result.version) {
                    setCurrentDraftVersion(result.version);
                }
                setStatus('waiting_feedback');
                addMessage('assistant', '修改已完成，可查看差异并继续反馈。');
            } else {
                setEditorStatus('error');
                throw new Error(result.error || 'Edit failed');
            }

            setIsGenerating(false);
        } catch (e) {
            addMessage('error', '编辑失败: ' + e.message);
            setEditorStatus('error');
            setIsGenerating(false);
            setStatus('waiting_feedback');
        }
    };

    const handleAcceptAllDiff = () => {
        if (!diffReview) return;
        const nextContent = diffReview.revisedContent || '';
        setManualContent(nextContent);
        dispatch({ type: 'SET_WORD_COUNT', payload: countChars(nextContent) });
        dispatch({ type: 'SET_SELECTION_COUNT', payload: 0 });
        clearDiffReview();
    };

    const handleRejectAllDiff = () => {
        if (!diffReview) return;
        const nextContent = diffReview.originalContent || '';
        setManualContent(nextContent);
        dispatch({ type: 'SET_WORD_COUNT', payload: countChars(nextContent) });
        dispatch({ type: 'SET_SELECTION_COUNT', payload: 0 });
        clearDiffReview();
    };

    const saveDraftContent = async () => {
        if (!chapterInfo.chapter) return { success: false };
        const resp = await draftsAPI.updateContent(projectId, chapterInfo.chapter, {
            content: manualContent,
            title: chapterInfo.chapter_title || ''
        });
        if (resp.data?.success) {
            const normalizedChapter = resp.data?.chapter || chapterInfo.chapter;
            if (normalizedChapter && normalizedChapter !== chapterInfo.chapter) {
                setChapterInfo((prev) => ({ ...prev, chapter: normalizedChapter }));
                dispatch({ type: 'SET_ACTIVE_DOCUMENT', payload: { type: 'chapter', id: normalizedChapter } });
                await loadChapters();
            }
            if (resp.data?.title !== undefined) {
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
            if (activeCard.type === 'character') {
                const payload = {
                    name,
                    description: cardForm.description || ''
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
                const payload = {
                    name,
                    description: cardForm.description || ''
                };
                if (activeCard.isNew || !activeCard.originalName) {
                    await cardsAPI.createWorld(projectId, payload);
                } else if (activeCard.originalName !== name) {
                    await cardsAPI.createWorld(projectId, payload);
                    await cardsAPI.deleteWorld(projectId, activeCard.originalName);
                } else {
                    await cardsAPI.updateWorld(projectId, activeCard.originalName, payload);
                }
            }
            addMessage('system', '卡片已更新');
            dispatch({ type: 'SET_SAVED' });
        } catch (e) {
            addMessage('error', '卡片保存失败: ' + e.message);
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
                                    <p className="text-xs text-ink-400 font-mono uppercase tracking-wider">{activeCard.type === 'character' ? 'CHARACTER CARD' : 'WORLD CARD'}</p>
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
                                <label className="text-xs font-bold text-ink-500 uppercase tracking-wider">名称 / Name</label>
                                <Input
                                    value={cardForm.name}
                                    onChange={e => setCardForm(prev => ({ ...prev, name: e.target.value }))}
                                    className="font-serif text-lg bg-surface/50 font-bold"
                                />
                            </div>

                            {/* Card Description */}
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-ink-500 uppercase tracking-wider">Description</label>
                                <textarea
                                    className="w-full min-h-[200px] p-3 rounded-md border border-input bg-surface/50 text-sm focus:ring-1 focus:ring-primary resize-none overflow-hidden"
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
                                    placeholder="Write a concise description"
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
                            <h1 className="text-4xl font-serif font-bold text-ink-900/30 mb-4">
                                NOVIX IDE
                            </h1>
                            <p className="text-sm text-ink-500">
                                请在左侧选择资源，或使用 Cmd+B 切换面板
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
                        {diffReview && diffReview.hunks?.length > 0 && (
                            <div className="mb-4 space-y-2">
                                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
                                    请先处理编辑修改建议，再继续手动编辑。
                                </div>
                                <InlineDiffEditor
                                    originalContent={diffReview.originalContent || ''}
                                    revisedContent={diffReview.revisedContent || ''}
                                    hunks={diffReview.hunks}
                                    stats={diffReview.stats}
                                    onAccept={handleAcceptAllDiff}
                                    onReject={handleRejectAllDiff}
                                    className="border border-border bg-surface rounded-lg"
                                />
                                <div className="text-[11px] text-ink-400">
                                    当前为内联 Diff 预览，接受/拒绝后将回到正文编辑。
                                </div>
                            </div>
                        )}

                        {streamingState.active ? (
                            <StreamingDraftView
                                content={manualContent}
                                progress={streamingState.progress}
                                active={streamingState.active}
                                className="flex-1"
                            />
                        ) : (
                            <textarea
                                className="flex-1 w-full resize-none border-none outline-none bg-transparent text-base font-serif text-ink-900 leading-relaxed focus:ring-0 placeholder:text-ink-300"
                                value={manualContent}
                                onChange={(e) => {
                                    const nextValue = e.target.value;
                                    setManualContent(nextValue);
                                    dispatch({ type: 'SET_WORD_COUNT', payload: countChars(nextValue) });
                                    const stats = getSelectionStats(nextValue, e.target.selectionStart, e.target.selectionEnd);
                                    dispatch({ type: 'SET_SELECTION_COUNT', payload: stats.selectionCount });
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
                                disabled={!chapterInfo.chapter || isGenerating || Boolean(diffReview)}
                                spellCheck={false}
                            />
                        )}

                    </motion.div>
                )}
            </AnimatePresence>
        );
    };

    const rightPanelContent = (
        <AgentsPanel traceEvents={traceEvents} agentTraces={agentTraces}>
            <AgentStatusPanel
                mode={agentMode}
                archivistStatus={archivistStatus}
                writerStatus={writerStatus}
                editorStatus={editorStatus}
                archivistOutput={archivistOutput}
                messages={messages}
                onSubmit={(text) => {
                    // Route based on content state
                    const hasContent = manualContent && manualContent.length > 50;

                    if (status === 'waiting_feedback' || hasContent) {
                        // Has content - treat as edit feedback
                        handleSubmitFeedback(text);
                    } else if (chapterInfo.chapter) {
                        // No content but chapter selected - start new generation
                        addMessage('user', text);
                        handleStart(chapterInfo.chapter, 'deep', text);
                    } else {
                        // No chapter selected
                        addMessage('system', '请先选择章节以开始生成。');
                    }
                }}
            />
        </AgentsPanel>
    );


    
    const saveBusy = isSaving || analysisLoading || analysisSaving;
    const showSaveAction = (chapterInfo.chapter || status === 'card_editing') && !isGenerating;
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
            : (chapterInfo.chapter ? (chapterInfo.chapter_title || `Chapter ${chapterInfo.chapter}`) : null)
    };

    return (
        <IDELayout rightPanelContent={rightPanelContent} titleBarProps={titleBarProps}>
            <div className="w-full h-full px-8 py-6">
                {renderMainContent()}
            </div>


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

export default function WritingSession(props) {
    const { projectId } = useParams();
    return (
        <IDEProvider projectId={projectId}>
            <WritingSessionContent {...props} />
        </IDEProvider>
    );
}
