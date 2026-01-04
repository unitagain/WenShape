import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { sessionAPI, createWebSocket, draftsAPI, cardsAPI } from '../api';
import { Button, Input, Card } from '../components/ui/core';
import { WritingCanvas } from '../components/writing/WritingCanvas';
import { WritingSidebar } from '../components/writing/WritingSidebar';
import {
    Play, RotateCcw, Check, MessageSquare, AlertTriangle,
    Terminal, Sparkles, Save, ChevronLeft, Bot, PanelRight, Plus,
    BookOpen, PenTool, Eraser, X
} from 'lucide-react';
import { ChapterCreateDialog } from '../components/project/ChapterCreateDialog';

function WritingSession({ isEmbedded = false }) {
    const { projectId } = useParams();
    const navigate = useNavigate();

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

    const [chapterInfo, setChapterInfo] = useState({
        chapter: '',
        chapter_title: '',
        chapter_goal: '',
        target_word_count: 3000
    });

    const [isStarting, setIsStarting] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const wsRef = useRef(null);
    const logContainerRef = useRef(null);

    const isGenerating = ['starting', 'finalizing'].includes(status);

    // --- Initialization ---

    useEffect(() => {
        wsRef.current = createWebSocket(projectId, handleWebSocketMessage);
        return () => {
            if (wsRef.current) wsRef.current.close();
        };
    }, [projectId]);

    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [messages]);

    useEffect(() => {
        loadChapters();
    }, [projectId]);

    // Sync Draft to Manual Content
    useEffect(() => {
        if (currentDraft && currentDraft.content) {
            setManualContent(currentDraft.content);
        } else if (!currentDraft) {
            setManualContent('');
        }
    }, [currentDraft]);

    // --- Data Loading ---

    const loadChapters = async () => {
        try {
            const resp = await draftsAPI.listChapters(projectId);
            const list = Array.isArray(resp.data) ? resp.data : [];
            setChapters(list.sort());
        } catch (e) {
            console.error("Failed to load chapters", e);
        }
    };

    const loadDraftContent = async (chapterId) => {
        if (!chapterId) return;

        // Reset partial state
        setCurrentDraft(null);
        setStatus('idle');
        setReview(null);
        setSceneBrief(null);
        setDraftV1(null);
        setProposals([]);

        try {
            // 1. Get List of Versions
            const vResp = await draftsAPI.listVersions(projectId, chapterId);
            const versions = vResp.data;

            if (versions && versions.length > 0) {
                // 2. Get Latest Version
                const lastVersion = versions[versions.length - 1];
                const dResp = await draftsAPI.getDraft(projectId, chapterId, lastVersion);

                if (dResp.data && dResp.data.content) {
                    // Found existing content -> Editing Mode
                    setCurrentDraft({ content: dResp.data.content });
                    setManualContent(dResp.data.content);
                    setStatus('editing');

                    setChapterInfo(prev => ({
                        ...prev,
                        chapter: chapterId,
                        chapter_title: dResp.data.title || ''
                    }));
                }
            } else {
                // No content -> Idle (Creation) Mode
                setStatus('idle');
                setManualContent('');
            }
        } catch (e) {
            console.error("Failed to load draft", e);
            setStatus('idle');
        }
    };

    const handleChapterSelect = (e) => {
        const ch = e.target.value;
        setChapterInfo(prev => ({
            ...prev,
            chapter: ch,
            chapter_title: '',
            chapter_goal: ''
        }));
        loadDraftContent(ch);
    };

    const handleChapterCreate = async ({ id, title, type }) => {
        try {
            await loadChapters();
            setChapterInfo(prev => ({
                ...prev,
                chapter: id,
                chapter_title: title,
                chapter_goal: ''
            }));
            setCurrentDraft(null);
            setManualContent('');
            setStatus('idle');
            setProposals([]);
        } catch (e) {
            console.error(e);
        }
    };

    // --- WebSocket & Actions ---

    const handleWebSocketMessage = (data) => {
        if (data.status) {
            setStatus(data.status);
            addMessage('system', data.message);
        }
    };

    const addMessage = (type, content) => {
        setMessages(prev => [...prev, { type, content, time: new Date() }]);
    };

    const startSession = async (e) => {
        e.preventDefault();
        if (!chapterInfo.chapter) {
            alert("请先选择或创建章节");
            return;
        }

        setIsStarting(true);
        setStatus('starting');
        setMessages([]);
        setShowStartModal(false);
        setProposals([]);

        try {
            const response = await sessionAPI.start(projectId, chapterInfo);

            if (response.data.success) {
                setCurrentDraft(response.data.draft_v2);
                setReview(response.data.review);
                setSceneBrief(response.data.scene_brief);
                setDraftV1(response.data.draft_v1);
                if (response.data.proposals) {
                    setProposals(response.data.proposals);
                }
                setStatus('waiting_feedback');
            } else {
                addMessage('error', 'SESSION_START_FAILED: ' + response.data.error);
                setStatus('error');
            }
        } catch (error) {
            addMessage('error', 'SYSTEM_ERROR: ' + (error.response?.data?.detail || error.message));
            setStatus('error');
        } finally {
            setIsStarting(false);
        }
    };

    // --- Manual Edit & Analysis ---

    const handleManualSave = async () => {
        if (!chapterInfo.chapter) return;
        setIsSaving(true);
        try {
            // 1. Save Content
            const resp = await draftsAPI.updateContent(projectId, chapterInfo.chapter, { content: manualContent });
            if (resp.data.success) {
                // Update current draft version reference if needed?
                // Actually locally we just care about content.
                addMessage('system', '草稿已保存');
                setShowSaveDialog(true); // Open Dialog to ask for Analysis
            }
        } catch (e) {
            addMessage('error', '保存失败: ' + e.message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleAnalyzeConfirm = async () => {
        setShowSaveDialog(false);
        try {
            // Trigger Analysis
            addMessage('system', '正在启动管理员整理流程...');
            const resp = await sessionAPI.analyze(projectId, { chapter: chapterInfo.chapter });
            if (resp.proposals) {
                setProposals(resp.proposals);
                addMessage('system', `管理员整理完成。发现 ${resp.proposals.length} 个新设定变更。`);
            } else {
                addMessage('system', '管理员整理完成，信息已更新。');
            }
        } catch (e) {
            addMessage('error', '整理失败: ' + e.message);
        }
    };

    // --- Feedback ---

    const continueWriting = async () => {
        setFeedback("请继续往下写...");
        submitFeedback('revise');
    };

    const submitFeedback = async (action) => {
        if (isSubmitting) return;
        setIsSubmitting(true);
        try {
            if (action === 'confirm') {
                setStatus('finalizing');
            }

            const response = await sessionAPI.submitFeedback(projectId, {
                chapter: chapterInfo.chapter,
                feedback: feedback,
                action: action,
                rejected_entities: rejectedItems
            });

            if (action === 'confirm') {
                if (response.data?.success) {
                    setStatus('completed');
                    alert("章节已确认和保存!");
                    loadDraftContent(chapterInfo.chapter);
                    setRejectedItems([]); // Clear rejections
                    setProposals([]);
                } else {
                    setStatus('waiting_feedback');
                }
            } else {
                if (response.data.success) {
                    setCurrentDraft(response.data.draft);
                    if (response.data.proposals) {
                        setProposals(response.data.proposals);
                    }
                    setFeedback('');
                    setStatus('editing');
                    setRejectedItems([]); // Clear rejections as they've been sent
                }
            }
        } catch (error) {
            addMessage('error', 'SUBMISSION_ERROR: ' + error.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    // --- Render ---

    return (
        <div className={`flex w-full bg-background relative overflow-hidden ${isEmbedded ? 'h-full' : 'h-screen'}`}>

            {/* Floating Header */}
            <header className={`absolute top-0 left-0 right-0 h-16 pointer-events-none z-10 flex items-center justify-between px-6 transition-all duration-300 ${showSaveDialog ? 'opacity-0 invisible' : 'opacity-100 visible'}`}
                style={{ paddingRight: sidebarOpen ? '26rem' : '1.5rem' }}>
                <div className="pointer-events-auto flex items-center gap-2">
                    {!isEmbedded && (
                        <Button variant="ghost" size="sm" onClick={() => navigate(`/project/${projectId}`)}>
                            <ChevronLeft className="mr-2 h-4 w-4" /> 返回
                        </Button>
                    )}
                </div>

                <div className="pointer-events-auto flex items-center gap-2">
                    {/* Manual Save Button - Always visible if chapter is selected and not generating */}
                    {chapterInfo.chapter && !isGenerating && (
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={handleManualSave}
                            disabled={isSaving}
                            className="bg-surface/50 backdrop-blur border-input shadow-sm"
                        >
                            <Save size={14} className="mr-2" />
                            {isSaving ? "保存中..." : "保存草稿"}
                        </Button>
                    )}

                    <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(!sidebarOpen)}>
                        {sidebarOpen ? <PanelRight className="text-primary" /> : <PanelRight />}
                    </Button>
                </div>
            </header>

            {/* Main Canvas Container */}
            <div
                className="flex-1 h-full overflow-hidden transition-all duration-300 ease-in-out"
                style={{ marginRight: sidebarOpen ? '24rem' : '0' }}
            >
                <WritingCanvas className="pt-20 h-full">
                    {!chapterInfo.chapter ? (
                        <div className="h-[60vh] flex flex-col items-center justify-center text-ink-400">
                            <div className="text-center">
                                <h1 className="text-4xl font-serif font-bold text-ink-900 mb-4">
                                    {chapterInfo.chapter_title || "无标题"}
                                </h1>
                                <p className="font-sans text-sm text-ink-500">
                                    请选择或创建章节以开始
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="h-[85vh] w-full max-w-[800px] mx-auto flex flex-col animate-fade-in relative">
                            <h1 className="text-4xl font-serif font-bold text-ink-900 mb-6 border-b border-border pb-4 shrink-0">
                                {chapterInfo.chapter_title || `Chapter ${chapterInfo.chapter}`}
                            </h1>

                            {/* Editable Text Area */}
                            <textarea
                                className="w-full flex-1 resize-none border-none outline-none bg-transparent whitespace-pre-wrap leading-loose text-lg font-serif text-ink-900 placeholder:text-ink-300 p-2 custom-scrollbar focus:ring-0"
                                value={manualContent}
                                onChange={(e) => setManualContent(e.target.value)}
                                placeholder="在此输入内容..."
                                disabled={isGenerating || !chapterInfo.chapter}
                                spellCheck={false}
                            />
                            {isGenerating && (
                                <div className="absolute inset-0 bg-background/20 backdrop-blur-[1px] flex items-center justify-center z-10 pointer-events-none">
                                    <div className="bg-surface border border-border px-4 py-2 rounded-full shadow-lg flex items-center gap-2">
                                        <Sparkles size={16} className="text-primary animate-spin" />
                                        <span className="text-sm font-medium">AI 生成中...</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </WritingCanvas>
            </div>

            {/* AI Sidebar */}
            <WritingSidebar
                isOpen={sidebarOpen}
                onClose={() => setSidebarOpen(false)}
                title={status === 'editing' ? "编辑助手" : "创作助手"}
                icon={status === 'editing' ? PenTool : Bot}
            >
                {/* 1. Context Information (Unified Panel) */}
                <div className="mb-6 space-y-4">
                    {/* Chapter Selector & ID */}
                    <div className="p-3 bg-surface/50 rounded-xl border border-border/50 space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase text-ink-400 tracking-wider">当前章节</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono border ${status === 'editing' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                                {status === 'editing' ? '⚫ EDITING' : '⚪ IDLE'}
                            </span>
                        </div>

                        <div className="flex gap-2">
                            <select
                                className="flex-1 rounded-lg border border-input bg-background/50 px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary cursor-pointer transition-all hover:border-primary/30"
                                value={chapterInfo.chapter}
                                onChange={handleChapterSelect}
                            >
                                <option value="">-- 选择章节 --</option>
                                {chapters.map(ch => (
                                    <option key={ch} value={ch}>{ch}</option>
                                ))}
                            </select>
                            <Button
                                size="icon"
                                variant="outline"
                                onClick={() => setShowChapterDialog(true)}
                                title="新建章节"
                                className="rounded-lg border-input hover:border-primary hover:text-primary transition-all bg-background/50"
                            >
                                <Plus size={16} />
                            </Button>
                        </div>

                        {chapterInfo.chapter && (
                            <div className="flex items-center gap-2 animate-in fade-in pt-1">
                                <div className="h-9 min-w-[3.5rem] px-2 flex items-center justify-center bg-primary/5 text-primary border border-primary/20 rounded-lg text-xs font-mono font-bold shadow-sm">
                                    {chapterInfo.chapter}
                                </div>
                                <Input
                                    value={chapterInfo.chapter_title}
                                    onChange={e => setChapterInfo({ ...chapterInfo, chapter_title: e.target.value })}
                                    placeholder="章节标题..."
                                    className="h-9 font-serif border-input bg-background/50 focus:bg-background transition-all"
                                />
                            </div>
                        )}
                    </div>
                </div>

                {/* 2. Mode Specific Cards */}
                {status === 'idle' && chapterInfo.chapter && (
                    <div className="space-y-4 animate-in slide-in-from-right-4 fade-in duration-300">
                        <div className="p-3 bg-primary/5 border border-primary/10 rounded-md text-xs text-ink-600 leading-relaxed">
                            <Sparkles size={12} className="inline mr-1 text-primary" />
                            当前为空白章节。配置目标由 AI 生成初稿，或手动输入内容开启编辑模式。
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold uppercase text-ink-500">本章目标</label>
                            <textarea
                                className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary resize-none"
                                value={chapterInfo.chapter_goal}
                                onChange={e => setChapterInfo({ ...chapterInfo, chapter_goal: e.target.value })}
                                placeholder="例如：主角在酒馆遇到了神秘人，获得了一张藏宝图..."
                            />
                        </div>
                        <Button className="w-full shadow-md" onClick={startSession} disabled={isStarting}>
                            {isStarting ? <Sparkles className="animate-spin mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
                            生成初稿
                        </Button>
                    </div>
                )}

                {(status === 'editing' || status === 'waiting_feedback' || status === 'completed') && (
                    <div className="space-y-6 animate-in slide-in-from-right-4 fade-in duration-300">
                        {status === 'editing' && (
                            <div className="grid grid-cols-2 gap-3">
                                <Button variant="outline" onClick={continueWriting} className="border-input hover:border-primary/50 text-ink-900">
                                    <PenTool size={14} className="mr-2" /> 续写
                                </Button>
                                <Button variant="outline" onClick={() => setStatus('waiting_feedback')} className="border-input hover:border-primary/50 text-ink-900">
                                    <Bot size={14} className="mr-2" /> 审稿
                                </Button>
                            </div>
                        )}
                        <div className="space-y-2">
                            <label className="text-xs font-bold uppercase text-ink-500 flex items-center justify-between">
                                <span>编辑指令</span>
                                {status === 'waiting_feedback' && <span className="text-primary text-[10px]">等待确认...</span>}
                            </label>
                            <textarea
                                value={feedback}
                                onChange={e => setFeedback(e.target.value)}
                                className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary leading-relaxed"
                                placeholder="输入指令：例如'扩写这一段'，'修改对话语气'，或直接输入续写内容..."
                            />
                            <div className="flex gap-2 pt-2">
                                <Button onClick={() => submitFeedback('revise')} disabled={!feedback.trim() || isSubmitting} className="flex-1 shadow-sm">
                                    <RotateCcw size={14} className="mr-2" /> 执行指令
                                </Button>
                                {(status === 'waiting_feedback' || status === 'completed') && (
                                    <Button onClick={() => submitFeedback('confirm')} disabled={isSubmitting} variant="outline" className="flex-1 border-green-200 text-green-700 hover:bg-green-50 hover:border-green-300">
                                        <Check size={14} className="mr-2" /> 完成
                                    </Button>
                                )}
                            </div>
                        </div>

                        {/* Unified Agent Workflow Timeline (4-Agents) */}
                        <div className="space-y-4 pt-4 border-t border-border animate-in slide-in-from-right-4 fade-in duration-300">
                            <h4 className="font-bold text-sm text-ink-900 flex items-center gap-2 mb-2">
                                <Bot size={14} className="text-primary" />
                                智能体工作流
                            </h4>

                            {/* 1. Archivist: Scene Brief */}
                            {sceneBrief && (
                                <div className="relative pl-4 border-l-2 border-indigo-200 pb-4 last:border-0 last:pb-0">
                                    <div className="absolute -left-[5px] top-0 w-2.5 h-2.5 rounded-full bg-indigo-400 ring-2 ring-background" />
                                    <div
                                        className="text-xs font-bold text-indigo-700 mb-1 flex justify-between cursor-pointer hover:bg-indigo-50/50 rounded px-1 -ml-1 py-0.5 transition-colors"
                                        onClick={() => toggleStep('archivist')}
                                    >
                                        <span>📚 资料员 (Archivist)</span>
                                        <span className="opacity-50 font-normal text-[10px]">{expandedSteps.archivist ? '收起' : '展开'}</span>
                                    </div>
                                    <div className={`transition-all duration-300 overflow-hidden ${expandedSteps.archivist ? 'max-h-[300px]' : 'max-h-0'}`}>
                                        <div className="bg-indigo-50/50 rounded border border-indigo-100/60 p-2 space-y-1 mt-1 text-[11px] text-ink-600">
                                            <div className="flex gap-2">
                                                <span className="font-bold text-indigo-800 shrink-0">目标:</span>
                                                <span className="leading-tight">{sceneBrief.goal}</span>
                                            </div>
                                            <div className="flex gap-2">
                                                <span className="font-bold text-indigo-800 shrink-0">角色:</span>
                                                <span className="leading-tight">{sceneBrief.characters?.map(c => c.name).join(', ') || '无'}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* 2. Writer: Draft V1 */}
                            {draftV1 && (
                                <div className="relative pl-4 border-l-2 border-slate-200 pb-4 last:border-0 last:pb-0">
                                    <div className="absolute -left-[5px] top-0 w-2.5 h-2.5 rounded-full bg-slate-400 ring-2 ring-background" />
                                    <div
                                        className="text-xs font-bold text-slate-700 mb-1 flex justify-between cursor-pointer hover:bg-slate-50/50 rounded px-1 -ml-1 py-0.5 transition-colors"
                                        onClick={() => toggleStep('writer')}
                                    >
                                        <span>✍️ 作家 (Writer)</span>
                                        <span className="opacity-50 font-normal text-[10px]">{expandedSteps.writer ? '收起' : '展开'}</span>
                                    </div>
                                    <div className={`transition-all duration-300 overflow-hidden ${expandedSteps.writer ? 'max-h-[300px]' : 'max-h-0'}`}>
                                        <div className="bg-slate-50/50 rounded border border-slate-100/60 p-2 mt-1 text-[11px] text-ink-600">
                                            <PenTool size={10} className="inline mr-1" />
                                            已完成初稿撰写 (字数: {draftV1.word_count})
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* 3. Reviewer: Analysis */}
                            {review && (
                                <div className="relative pl-4 border-l-2 border-amber-200 pb-4 last:border-0 last:pb-0">
                                    <div className="absolute -left-[5px] top-0 w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-background" />
                                    <div
                                        className="text-xs font-bold text-amber-700 mb-1 flex justify-between cursor-pointer hover:bg-amber-50/50 rounded px-1 -ml-1 py-0.5 transition-colors"
                                        onClick={() => toggleStep('review')}
                                    >
                                        <span>⚖️ 审稿人 (Reviewer)</span>
                                        <span className="opacity-50 font-normal text-[10px]">{expandedSteps.review ? '收起' : '展开'}</span>
                                    </div>
                                    <div className={`transition-all duration-300 overflow-hidden ${expandedSteps.review ? 'max-h-[500px]' : 'max-h-0'}`}>
                                        <div className="bg-amber-50/50 rounded border border-amber-100/60 p-2 space-y-2 mt-1">
                                            {review.issues.length === 0 ? (
                                                <div className="text-[11px] text-amber-800 flex items-center gap-1">
                                                    <Check size={12} /> 未发现严重问题
                                                </div>
                                            ) : (
                                                review.issues.map((issue, idx) => (
                                                    <div key={idx} className="text-xs group border-b border-amber-100/50 last:border-0 pb-2 last:pb-0">
                                                        <div className="font-bold text-amber-800 flex items-center gap-1 mb-0.5">
                                                            <span className="bg-amber-100 text-[9px] px-1 rounded uppercase min-w-[30px] text-center">{issue.category}</span>
                                                            <span className="font-normal text-ink-700 leading-tight">{issue.problem}</span>
                                                        </div>
                                                        {issue.suggestion && (
                                                            <div className="text-[10px] text-ink-500 pl-1 border-l-2 border-amber-200 ml-1 mt-0.5 italic leading-tight">
                                                                {issue.suggestion}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* 4. Editor: Revision */}
                            {review && status === 'editing' && (
                                <div className="relative pl-4 border-l-2 border-blue-200 pb-4 last:border-0 last:pb-0">
                                    <div className="absolute -left-[5px] top-0 w-2.5 h-2.5 rounded-full bg-blue-400 ring-2 ring-background" />
                                    <div
                                        className="text-xs font-bold text-blue-700 mb-1 flex justify-between cursor-pointer hover:bg-blue-50/50 rounded px-1 -ml-1 py-0.5 transition-colors"
                                        onClick={() => toggleStep('editor')}
                                    >
                                        <span>📝 编辑 (Editor)</span>
                                        <span className="opacity-50 font-normal text-[10px]">{expandedSteps.editor ? '收起' : '展开'}</span>
                                    </div>
                                    <div className={`transition-all duration-300 overflow-hidden ${expandedSteps.editor ? 'max-h-[300px]' : 'max-h-0'}`}>
                                        <div className="text-[11px] text-ink-600 bg-blue-50/50 p-2 rounded border border-blue-100 mt-1">
                                            <Check size={10} className="inline mr-1 text-blue-600" />
                                            已根据审稿意见完成全文修订与润色。
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* 3. Archivist Step */}
                            {proposals.length > 0 && (
                                <div className="relative pl-4 border-l-2 border-purple-200 pb-0">
                                    <div className="absolute -left-[5px] top-0 w-2.5 h-2.5 rounded-full bg-purple-400 ring-2 ring-background" />
                                    <div className="text-xs font-bold text-purple-700 mb-1 flex justify-between">
                                        <span>Archivist Agent</span>
                                        <span className="opacity-50 font-normal">New Settings ({proposals.length})</span>
                                    </div>
                                    <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-1">
                                        {proposals.map((p, idx) => (
                                            <div key={idx} className="p-2 bg-purple-50/50 rounded border border-purple-100 text-ink-700 relative group transition-colors hover:bg-purple-50">
                                                <div className="flex justify-between items-start mb-1">
                                                    <span className="font-bold text-purple-800 text-[10px] px-1.5 py-0.5 bg-purple-100 rounded">
                                                        {p.type}: {p.name}
                                                    </span>
                                                    <span className="text-[9px] text-purple-400 font-mono">
                                                        {(p.confidence * 100).toFixed(0)}%
                                                    </span>
                                                </div>
                                                <p className="text-[10px] leading-relaxed mb-1 font-medium">{p.rationale}</p>
                                                <p className="text-[10px] text-ink-500 mb-2">{p.description}</p>

                                                <div className="flex gap-2">
                                                    <Button size="sm" variant="outline" className="h-5 text-[10px] px-2 py-0 border-green-200 text-green-700 hover:bg-green-50"
                                                        onClick={async () => {
                                                            try {
                                                                if (p.type === 'Character') await cardsAPI.createCharacter(projectId, { name: p.name, identity: p.description, motivation: "Unset", boundaries: [] });
                                                                else if (p.type === 'World') await cardsAPI.createWorld(projectId, { name: p.name, category: 'Location', description: p.description, rules: [] });
                                                                setProposals(prev => prev.filter(x => x.name !== p.name));
                                                                addMessage('system', `已采纳: ${p.name}`);
                                                            } catch (e) { addMessage('error', e.message); }
                                                        }}>
                                                        <Check size={10} className="mr-1" /> 采纳
                                                    </Button>
                                                    <Button size="sm" variant="outline" className="h-5 text-[10px] px-2 py-0 border-red-200 text-red-700 hover:bg-red-50"
                                                        onClick={() => {
                                                            setRejectedItems(prev => [...prev, p.name]);
                                                            setProposals(prev => prev.filter(x => x.name !== p.name));
                                                        }}>
                                                        <Eraser size={10} className="mr-1" /> 拒绝
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
                <div className="mt-auto pt-6 border-t border-border">
                    <div className="flex items-center gap-2 mb-2 text-[10px] font-bold uppercase text-ink-400">
                        <Terminal size={10} />
                        System Logs
                    </div>
                    <div ref={logContainerRef} className="h-24 overflow-y-auto bg-gray-50 border border-border rounded p-2 text-[10px] font-mono space-y-1 text-ink-500">
                        {messages.length === 0 && <span className="opacity-30 italic">Ready...</span>}
                        {messages.map((m, i) => (
                            <div key={i} className="leading-tight">
                                <span className="opacity-40 mr-1.5">[{m.time.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })}]</span>
                                {m.content}
                            </div>
                        ))}
                    </div>
                </div>
            </WritingSidebar>

            {/* Chapter Dialog */}
            <ChapterCreateDialog
                open={showChapterDialog}
                onClose={() => setShowChapterDialog(false)}
                onConfirm={handleChapterCreate}
                existingChapters={chapters.map(c => ({ id: c, title: '' }))}
            />

            {/* Analysis Confirmation Dialog */}
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

        </div>
    );
}

export default WritingSession;
