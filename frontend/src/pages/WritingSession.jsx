import { useState, useEffect, useRef } from 'react';
import useSWR from 'swr';
import { motion, AnimatePresence } from 'framer-motion';
import { useParams, useNavigate } from 'react-router-dom';
import { sessionAPI, createWebSocket, draftsAPI, cardsAPI, projectsAPI } from '../api';
import { Button, Input, Card } from '../components/ui/core';
import { WritingCanvas } from '../components/writing/WritingCanvas';
import { WritingSidebar } from '../components/writing/WritingSidebar';
import {
    Play, RotateCcw, Check, MessageSquare, AlertTriangle,
    Terminal, Sparkles, Save, ChevronLeft, Bot, PanelRight, Plus,
    BookOpen, PenTool, Eraser, X
} from 'lucide-react';
import { ChapterCreateDialog } from '../components/project/ChapterCreateDialog';
import { IDELayout } from '../components/ide/IDELayout';
import { IDEProvider } from '../context/IDEContext';
import { useIDE } from '../context/IDEContext';

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
    const [showSaveDialog, setShowSaveDialog] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Proposal State
    const [proposals, setProposals] = useState([]);
    const [rejectedItems, setRejectedItems] = useState([]);

    // Logic State
    const [status, setStatus] = useState('idle'); // idle, starting, editing, waiting_feedback, completed
    const [messages, setMessages] = useState([]);
    const [currentDraft, setCurrentDraft] = useState(null);
    const [manualContent, setManualContent] = useState(''); // Textarea content
    const [review, setReview] = useState(null);
    const [sceneBrief, setSceneBrief] = useState(null);
    const [draftV1, setDraftV1] = useState(null);
    const [feedback, setFeedback] = useState('');
    const [expandedSteps, setExpandedSteps] = useState({ review: true, editor: true });

    const toggleStep = (step) => {
        setExpandedSteps(prev => ({ ...prev, [step]: !prev[step] }));
    };

    // WebSocket
    const wsRef = useRef(null);
    const [wsConnected, setWsConnected] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);

    // Chapter Info
    const [chapterInfo, setChapterInfo] = useState({
        chapter: null,
        chapter_title: null,
        content: null,
    });

    useEffect(() => {
        const ws = createWebSocket(projectId, (data) => {
            if (data.type === 'start_ack') addMessage('system', 'Session started!');
            if (data.type === 'review') handleReview(data.data);
            if (data.type === 'scene_brief') handleSceneBrief(data.data);
            if (data.type === 'draft_v1') handleDraftV1(data.data);
            if (data.type === 'final_draft') handleFinalDraft(data.data);
            if (data.type === 'error') addMessage('error', data.message);
        });
        wsRef.current = ws;
        setWsConnected(true);
        return () => {
            if (ws) ws.close();
        };
    }, [projectId]);

    // Card State
    const [activeCard, setActiveCard] = useState(null);
    const [cardForm, setCardForm] = useState({ name: '', identity: '', description: '' });

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

    // Sync SWR data to manualContent
    useEffect(() => {
        if (loadedContent !== undefined) {
            setManualContent(loadedContent);
            dispatch({ type: 'SET_WORD_COUNT', payload: loadedContent.length });
            // Only center cursor if we just switched chapters (optional optimization)
            // dispatch({ type: 'SET_CURSOR_POSITION', payload: { line: 1, column: 1 } });
        }
    }, [loadedContent, dispatch]);


    // 监听 Context 中的文档选择（章节或卡片）
    useEffect(() => {
        if (!state.activeDocument) return;

        if (state.activeDocument.type === 'chapter' && state.activeDocument.id) {
            setActiveCard(null); // Clear card state
            handleChapterSelect(state.activeDocument.id);
        } else if (['character', 'world'].includes(state.activeDocument.type)) {
            // Switch to Card Mode
            setChapterInfo({ chapter: null, chapter_title: null, content: null });

            // Initial setup with basic info
            const cardData = state.activeDocument.data || { name: state.activeDocument.id };
            setActiveCard({ ...cardData, type: state.activeDocument.type });
            setCardForm({
                name: cardData.name || '',
                identity: '',
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
                    if (resp.data) {
                        const fullData = resp.data;
                        setActiveCard(prev => ({ ...prev, ...fullData }));

                        // Populate form based on type
                        if (state.activeDocument.type === 'character') {
                            setCardForm({
                                name: fullData.name || '',
                                identity: fullData.identity || '',
                                appearance: fullData.appearance || '',
                                motivation: fullData.motivation || '',
                                personality: Array.isArray(fullData.personality) ? fullData.personality.join(', ') : (fullData.personality || ''),
                                speech_pattern: fullData.speech_pattern || '',
                                arc: fullData.arc || '',
                                boundaries: fullData.boundaries || []
                            });
                        } else {
                            setCardForm({
                                name: fullData.name || '',
                                category: fullData.category || '',
                                description: fullData.description || '',
                                rules: Array.isArray(fullData.rules) ? fullData.rules.join('\n') : (fullData.rules || ''),
                                immutable: fullData.immutable || false
                            });
                        }
                    }
                } catch (e) {
                    console.error("Failed to fetch card details", e);
                    addMessage('error', '加载卡片详情失败: ' + e.message);
                }
            };

            if (state.activeDocument.id) {
                fetchCardDetails();
            }
        }
    }, [state.activeDocument]);

    useEffect(() => {
        loadChapters();
    }, [projectId]);

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

    const handleChapterSelect = async (chapter) => {
        // Just set the chapter, let SWR handle fetching
        setChapterInfo({ chapter, chapter_title: `Chapter ${chapter}`, content: '' }); // content will be filled by SWR
        setStatus('editing');
    };

    const handleChapterCreate = async (chapterNum, chapterTitle) => {
        setChapterInfo({ chapter: chapterNum, chapter_title: chapterTitle, content: '' });
        setManualContent('');
        setShowChapterDialog(false);
        setStatus('idle');
        await loadChapters();
    };

    const addMessage = (type, content) => {
        setMessages(prev => [...prev, { type, content, time: new Date() }]);
    };

    // Handlers
    const handleStart = async (chapter, mode) => {
        if (!chapter) {
            alert('Please select a chapter first');
            return;
        }
        setStatus('starting');
        setIsGenerating(true);
        addMessage('system', `Starting writing session for Chapter ${chapter} in ${mode} mode...`);

        try {
            const resp = await sessionAPI.start(projectId, {
                chapter: Number(chapter),
                mode,
                context_sources: {
                    characters: true,
                    world_env: true,
                    previous_content: true,
                    fanfiction: true
                }
            });
            setChapterInfo({ chapter, chapter_title: `Chapter ${chapter}`, content: null });
            addMessage('system', 'Session started, waiting for results...');
        } catch (e) {
            addMessage('error', 'Failed to start: ' + e.message);
            setStatus('idle');
            setIsGenerating(false);
        }
    };

    const handleReview = (data) => {
        setReview(data);
        setStatus('editing');
        addMessage('system', 'Review received');
        setIsGenerating(false);
    };

    const handleSceneBrief = (data) => {
        setSceneBrief(data);
        addMessage('system', 'Scene brief received');
    };

    const handleDraftV1 = (data) => {
        setDraftV1(data);
        setManualContent(data.content || '');
        setStatus('waiting_feedback');
        addMessage('system', 'Draft V1 ready! Review and submit feedback or edit manually.');
        setIsGenerating(false);
    };

    const handleFinalDraft = (data) => {
        setCurrentDraft(data);
        setManualContent(data.content || '');
        setStatus('completed');
        addMessage('system', 'Final draft completed!');
        setIsGenerating(false);
    };

    const handleSubmitFeedback = async () => {
        if (!feedback.trim()) return;
        try {
            await sessionAPI.submitFeedback(projectId, { feedback });
            addMessage('user', `Feedback: ${feedback}`);
            setFeedback('');
            setStatus('starting');
            setIsGenerating(true);
            addMessage('system', 'Processing feedback...');
        } catch (e) {
            addMessage('error', 'Failed to submit feedback: ' + e.message);
        }
    };

    const handleManualSave = async () => {
        if (!chapterInfo.chapter) return;
        setIsSaving(true);
        try {
            const resp = await draftsAPI.updateContent(projectId, chapterInfo.chapter, { content: manualContent });
            if (resp.data.success) {
                addMessage('system', '草稿已保存');
                dispatch({ type: 'SET_SAVED' });
                setShowSaveDialog(true);
                // Update SWR cache
                mutateChapter(manualContent, false);
            }
        } catch (e) {
            addMessage('error', '保存失败: ' + e.message);
        } finally {
            setIsSaving(false);
        }
    };

    // Card Handlers
    const handleCardSave = async () => {
        if (!activeCard) return;
        setIsSaving(true);
        try {
            if (activeCard.type === 'character') {
                const payload = {
                    ...cardForm,
                    personality: typeof cardForm.personality === 'string' ? cardForm.personality.split(',').map(s => s.trim()).filter(Boolean) : cardForm.personality,
                    // ensure other array fields if needed
                };
                await cardsAPI.updateCharacter(projectId, activeCard.name, payload);
            } else {
                const payload = {
                    ...cardForm,
                    rules: typeof cardForm.rules === 'string' ? cardForm.rules.split('\n').filter(Boolean) : cardForm.rules
                };
                await cardsAPI.updateWorld(projectId, activeCard.name, payload);
            }
            addMessage('system', '卡片已更新');
            dispatch({ type: 'SET_SAVED' });
        } catch (e) {
            addMessage('error', '卡片保存失败: ' + e.message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleAnalyzeConfirm = async () => {
        setShowSaveDialog(false);
        if (!chapterInfo.chapter) return;
        try {
            const resp = await sessionAPI.analyze(projectId, { chapter: chapterInfo.chapter });
            if (resp.data.success) {
                addMessage('system', '分析任务已提交');
            }
        } catch (e) {
            addMessage('error', '分析失败: ' + e.message);
        }
    };

    const renderMainContent = () => {
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
                        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border">
                            <div className="p-2 bg-primary/10 rounded-lg text-primary">
                                {activeCard.type === 'character' ? <div className="i-lucide-user" /> : <div className="i-lucide-globe" />}
                                {activeCard.type === 'character' ? '👤' : '🌍'}
                            </div>
                            <div>
                                <h1 className="text-2xl font-serif font-bold text-ink-900">{cardForm.name || '未命名卡片'}</h1>
                                <p className="text-xs text-ink-400 font-mono uppercase tracking-wider">{activeCard.type === 'character' ? 'CHARACTER CARD' : 'WORLD CARD'}</p>
                            </div>
                        </div>

                        <div className="space-y-6 flex-1 overflow-y-auto px-1 pb-20">
                            {/* Common: Name */}
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-ink-500 uppercase tracking-wider">名称 / Name</label>
                                <Input
                                    value={cardForm.name}
                                    onChange={e => setCardForm(prev => ({ ...prev, name: e.target.value }))}
                                    className="font-serif text-lg bg-surface/50 font-bold"
                                    disabled
                                />
                            </div>

                            {/* Character Fields */}
                            {activeCard.type === 'character' && (
                                <>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-ink-500 uppercase tracking-wider">身份 / Identity</label>
                                        <Input
                                            value={cardForm.identity || ''}
                                            onChange={e => setCardForm(prev => ({ ...prev, identity: e.target.value }))}
                                            placeholder="e.g. 25岁，私家侦探"
                                            className="bg-surface/50"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-ink-500 uppercase tracking-wider">外貌 / Appearance</label>
                                        <textarea
                                            className="w-full min-h-[80px] p-3 rounded-md border border-input bg-surface/50 text-sm focus:ring-1 focus:ring-primary resize-y"
                                            value={cardForm.appearance || ''}
                                            onChange={e => setCardForm(prev => ({ ...prev, appearance: e.target.value }))}
                                            placeholder="外貌特征描述..."
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-ink-500 uppercase tracking-wider">核心动机 / Motivation</label>
                                        <Input
                                            value={cardForm.motivation || ''}
                                            onChange={e => setCardForm(prev => ({ ...prev, motivation: e.target.value }))}
                                            placeholder="角色的核心驱动力..."
                                            className="bg-surface/50"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-ink-500 uppercase tracking-wider">性格特征 / Personality (逗号分隔)</label>
                                        <Input
                                            value={cardForm.personality || ''}
                                            onChange={e => setCardForm(prev => ({ ...prev, personality: e.target.value }))}
                                            placeholder="勇敢, 鲁莽, 忠诚..."
                                            className="bg-surface/50"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-ink-500 uppercase tracking-wider">说话风格 / Speech Pattern</label>
                                        <Input
                                            value={cardForm.speech_pattern || ''}
                                            onChange={e => setCardForm(prev => ({ ...prev, speech_pattern: e.target.value }))}
                                            placeholder="语速快，喜欢用比喻..."
                                            className="bg-surface/50"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-ink-500 uppercase tracking-wider">角色弧光 / Arc</label>
                                        <textarea
                                            className="w-full min-h-[100px] p-3 rounded-md border border-input bg-surface/50 text-sm focus:ring-1 focus:ring-primary resize-y"
                                            value={cardForm.arc || ''}
                                            onChange={e => setCardForm(prev => ({ ...prev, arc: e.target.value }))}
                                            placeholder="角色的成长与变化路径..."
                                        />
                                    </div>
                                </>
                            )}

                            {/* World Fields */}
                            {activeCard.type === 'world' && (
                                <>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-ink-500 uppercase tracking-wider">类别 / Category</label>
                                        <Input
                                            value={cardForm.category || ''}
                                            onChange={e => setCardForm(prev => ({ ...prev, category: e.target.value }))}
                                            placeholder="e.g. 地点, 魔法, 组织..."
                                            className="bg-surface/50"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-ink-500 uppercase tracking-wider">详细描述 / Description</label>
                                        <textarea
                                            className="w-full min-h-[200px] p-3 rounded-md border border-input bg-surface/50 text-sm focus:ring-1 focus:ring-primary resize-y"
                                            value={cardForm.description || ''}
                                            onChange={e => setCardForm(prev => ({ ...prev, description: e.target.value }))}
                                            placeholder="关于此设定的详细描述..."
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-ink-500 uppercase tracking-wider">规则与约束 / Rules (每行一条)</label>
                                        <textarea
                                            className="w-full min-h-[150px] p-3 rounded-md border border-input bg-surface/50 text-sm focus:ring-1 focus:ring-primary resize-y font-mono"
                                            value={cardForm.rules || ''}
                                            onChange={e => setCardForm(prev => ({ ...prev, rules: e.target.value }))}
                                            placeholder="该设定涉及的规则..."
                                        />
                                    </div>
                                </>
                            )}
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
                        <h1 className="text-2xl font-serif font-bold text-ink-900 mb-4 pb-3 border-b border-border flex-shrink-0">
                            {chapterInfo.chapter_title || `第 ${chapterInfo.chapter} 章`}
                        </h1>
                        <textarea
                            className="flex-1 w-full resize-none border-none outline-none bg-transparent text-base font-serif text-ink-900 leading-relaxed focus:ring-0 placeholder:text-ink-300"
                            value={manualContent}
                            onChange={(e) => {
                                setManualContent(e.target.value);
                                dispatch({ type: 'SET_WORD_COUNT', payload: e.target.value.length });
                                dispatch({ type: 'SET_UNSAVED' });
                            }}
                            onSelect={(e) => {
                                const text = e.target.value.substring(0, e.target.selectionStart);
                                const lines = text.split('\n');
                                dispatch({
                                    type: 'SET_CURSOR_POSITION',
                                    payload: {
                                        line: lines.length,
                                        column: lines[lines.length - 1].length + 1
                                    }
                                });
                            }}
                            placeholder="开始写作..."
                            disabled={isGenerating || !chapterInfo.chapter}
                            spellCheck={false}
                        />
                        {isGenerating && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="absolute inset-0 bg-background/20 backdrop-blur-[1px] flex items-center justify-center z-10 pointer-events-none"
                            >
                                <motion.div
                                    animate={{ scale: [1, 1.05, 1], boxShadow: ["0 0 0 0px rgba(var(--primary), 0.2)", "0 0 0 10px rgba(var(--primary), 0)", "0 0 0 0px rgba(var(--primary), 0)"] }}
                                    transition={{ repeat: Infinity, duration: 2 }}
                                    className="bg-surface border border-border px-4 py-2 rounded-full shadow-lg flex items-center gap-2"
                                >
                                    <Sparkles size={16} className="text-primary animate-spin" />
                                    <span className="text-sm font-medium">AI 生成中...</span>
                                </motion.div>
                            </motion.div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        );
    };

    const rightPanelContent = (
        <WritingSidebar
            isOpen={true}
            onClose={() => dispatch({ type: 'TOGGLE_RIGHT_PANEL' })}
            title={status === 'card_editing' ? "卡片助手" : (status === 'editing' ? "编辑助手" : "创作助手")}
            icon={status === 'card_editing' ? Sparkles : (status === 'editing' ? PenTool : Bot)}
        >
            <div className="flex flex-col h-full overflow-hidden">
                <div className="flex-1 flex flex-col gap-4 overflow-y-auto p-4">
                    {/* Writing Mode: Chapter Selection */}
                    {status !== 'card_editing' && showStartModal && (
                        <div className="space-y-3 pb-4 border-b border-border">
                            <Button onClick={() => setShowChapterDialog(true)} size="sm" variant="outline" className="w-full justify-start">
                                <Plus size={14} className="mr-2" /> 新建章节
                            </Button>

                            <div className="text-xs text-ink-400 font-medium mb-1">选择章节:</div>
                            <div className="grid grid-cols-3 gap-1">
                                {chapters.map(c => (
                                    <Button
                                        key={c}
                                        size="sm"
                                        variant={chapterInfo.chapter === c ? 'default' : 'outline'}
                                        onClick={() => handleChapterSelect(c)}
                                        className="text-xs h-7"
                                    >
                                        {c}
                                    </Button>
                                ))}
                            </div>

                            {chapterInfo.chapter && status === 'idle' && (
                                <div className="space-y-2 pt-3">
                                    <div className="text-xs text-ink-400 font-medium">创作模式:</div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <Button size="sm" onClick={() => handleStart(chapterInfo.chapter, 'fast')} disabled={isGenerating}>
                                            <RotateCcw size={12} className="mr-1" /> 快速
                                        </Button>
                                        <Button size="sm" onClick={() => handleStart(chapterInfo.chapter, 'deep')} disabled={isGenerating}>
                                            <Bot size={12} className="mr-1" /> 深度
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Card Mode: Card Assistant Placeholder */}
                    {status === 'card_editing' && (
                        <div className="text-xs text-ink-500 text-center py-8">
                            <Sparkles size={24} className="mx-auto mb-2 text-primary/50" />
                            <p>AI 正在分析此卡片...</p>
                            <p className="opacity-50 mt-1">(完善建议即将上线)</p>
                        </div>
                    )}

                    {status === 'waiting_feedback' && (
                        <div className="space-y-2 pb-3 border-b border-border">
                            <div className="text-xs font-medium">Review & Feedback</div>
                            <textarea
                                className="w-full h-24 text-xs p-2 border border-border rounded resize-none"
                                placeholder="提供反馈..."
                                value={feedback}
                                onChange={(e) => setFeedback(e.target.value)}
                            />
                            <Button size="sm" onClick={handleSubmitFeedback} disabled={isGenerating} className="w-full">
                                提交反馈
                            </Button>
                        </div>
                    )}
                </div>

                <div className="border-t border-border bg-surface/50 p-2 max-h-[30vh] overflow-y-auto text-[10px] font-mono leading-tight space-y-1">
                    {messages.map((m, i) => (
                        <div key={i} className="leading-tight">
                            <span className="opacity-40 mr-1.5">[{m.time.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })}]</span>
                            {m.content}
                        </div>
                    ))}
                </div>
            </div>
        </WritingSidebar>
    );

    const titleBarProps = {
        projectName: project?.name,
        // Show Card Name in Title if card editing
        chapterTitle: status === 'card_editing' ? cardForm.name : (chapterInfo.chapter ? (chapterInfo.chapter_title || `第 ${chapterInfo.chapter} 章`) : null)
    };

    return (
        <IDELayout rightPanelContent={rightPanelContent} titleBarProps={titleBarProps}>
            <div className="w-full h-full px-8 py-6">
                {renderMainContent()}
            </div>

            <div className="fixed bottom-10 right-10 z-20">
                {(chapterInfo.chapter || status === 'card_editing') && !isGenerating && (
                    <Button
                        onClick={status === 'card_editing' ? handleCardSave : handleManualSave}
                        disabled={isSaving}
                        className="shadow-lg"
                    >
                        <Save size={14} className="mr-2" />
                        {isSaving ? "保存中..." : "保存"}
                    </Button>
                )}
            </div>

            <ChapterCreateDialog
                open={showChapterDialog}
                onClose={() => {
                    setShowChapterDialog(false);
                    dispatch({ type: 'CLOSE_CREATE_CHAPTER_DIALOG' });
                }}
                onConfirm={handleChapterCreate}
                existingChapters={chapters.map(c => ({ id: c, title: '' }))}
            />

            {showSaveDialog && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
                    <Card className="w-full max-w-md p-6 space-y-4 shadow-xl border-border bg-background relative">
                        <Button variant="ghost" size="icon" className="absolute right-4 top-4 text-ink-400 hover:text-ink-600" onClick={() => setShowSaveDialog(false)}>
                            <X size={16} />
                        </Button>
                        <div className="flex items-center gap-3 text-ink-900">
                            <Check className="h-6 w-6 text-green-600 bg-green-100 rounded-full p-1" />
                            <h3 className="text-lg font-bold font-serif">草稿已保存</h3>
                        </div>
                        <p className="text-sm text-ink-600 leading-relaxed">
                            您的改动已成功保存。是否需要管理员重新分析本章节，以更新摘要、事实和伏笔信息？
                        </p>
                        <p className="text-xs text-ink-400 bg-gray-50 p-2 rounded border border-border">
                            注意：如果不整理，AI 可能不会通过"记忆"得知您刚才修改的关键信息。
                        </p>
                        <div className="flex justify-end gap-3 pt-2">
                            <Button variant="ghost" onClick={() => setShowSaveDialog(false)}>
                                仅保存
                            </Button>
                            <Button onClick={handleAnalyzeConfirm}>
                                <Sparkles size={14} className="mr-2" /> 保存并整理
                            </Button>
                        </div>
                    </Card>
                </div>
            )}
        </IDELayout>
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
