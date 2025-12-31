import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { sessionAPI, createWebSocket, draftsAPI } from '../api';
import { Button, Input, Card } from '../components/ui/core';
import { WritingCanvas } from '../components/writing/WritingCanvas';
import { WritingSidebar } from '../components/writing/WritingSidebar';
import {
    Play, RotateCcw, Check, MessageSquare, AlertTriangle,
    Terminal, Sparkles, Save, ChevronLeft, Bot, PanelRight, Plus,
    BookOpen, PenTool, Eraser
} from 'lucide-react';
import { ChapterCreateDialog } from '../components/project/ChapterCreateDialog';

function WritingSession() {
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

    // Logic State
    const [status, setStatus] = useState('idle'); // idle, starting, editing, waiting_feedback, completed
    const [messages, setMessages] = useState([]);
    const [currentDraft, setCurrentDraft] = useState(null);
    const [manualContent, setManualContent] = useState(''); // Textarea content
    const [review, setReview] = useState(null);
    const [feedback, setFeedback] = useState('');

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

    const isGenerating = ['starting', 'waiting_feedback'].includes(status);

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

        try {
            const response = await sessionAPI.start(projectId, chapterInfo);

            if (response.data.success) {
                setCurrentDraft(response.data.draft_v2);
                setReview(response.data.review);
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
            await sessionAPI.analyze(projectId, { chapter: chapterInfo.chapter });
            addMessage('system', '管理员整理完成，信息已更新。');
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
                action: action
            });

            if (action === 'confirm') {
                if (response.data?.success) {
                    setStatus('completed');
                    alert("章节已确认和保存!");
                    loadDraftContent(chapterInfo.chapter);
                } else {
                    setStatus('waiting_feedback');
                }
            } else {
                if (response.data.success) {
                    setCurrentDraft(response.data.draft);
                    setFeedback('');
                    setStatus('editing');
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
        <div className="flex h-screen w-full bg-background relative overflow-hidden">

            {/* Floating Header */}
            <header className="absolute top-0 left-0 right-0 h-16 pointer-events-none z-10 flex items-center justify-between px-6 transition-all duration-300"
                style={{ paddingRight: sidebarOpen ? '26rem' : '1.5rem' }}>
                <div className="pointer-events-auto flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => navigate(`/project/${projectId}`)}>
                        <ChevronLeft className="mr-2 h-4 w-4" /> 返回
                    </Button>
                </div>

                <div className="pointer-events-auto flex items-center gap-2">
                    {/* Manual Save Button - Only visible if editing and not generating */}
                    {status === 'editing' && !isGenerating && (
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
                {/* 1. Chapter Selection */}
                <div className="mb-6 p-4 bg-surface border border-border rounded-lg shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-bold uppercase text-ink-500 tracking-wider">当前章节</label>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono ${status === 'editing' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                            {status === 'editing' ? 'EDITING' : 'NEW'}
                        </span>
                    </div>

                    <div className="flex gap-2">
                        <select
                            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary cursor-pointer"
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
                            className="border-input hover:border-primary hover:text-primary"
                        >
                            <Plus size={16} />
                        </Button>
                    </div>

                    {chapterInfo.chapter && (
                        <div className="flex gap-2 animate-in fade-in pt-1">
                            <div className="w-16 h-10 flex items-center justify-center bg-ink-900 text-surface border border-ink-900 rounded text-xs font-mono font-bold">
                                {chapterInfo.chapter}
                            </div>
                            <Input
                                value={chapterInfo.chapter_title}
                                onChange={e => setChapterInfo({ ...chapterInfo, chapter_title: e.target.value })}
                                placeholder="输入标题..."
                                className="h-10 font-serif border-input"
                            />
                        </div>
                    )}
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
                        {review?.issues?.length > 0 && (
                            <div className="space-y-3 pt-4 border-t border-border">
                                <h4 className="font-bold text-sm text-ink-900 flex items-center gap-2">
                                    <AlertTriangle size={14} className="text-amber-500" />
                                    优化建议
                                </h4>
                                <div className="space-y-2 max-h-[200px] overflow-y-auto custom-scrollbar pr-1">
                                    {review.issues.map((issue, idx) => (
                                        <div key={idx} className="text-xs p-3 bg-amber-50/50 rounded-lg border border-amber-100 text-ink-700">
                                            <span className="font-bold text-amber-700 block mb-1">[{issue.category}]</span>
                                            {issue.description}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
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
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in">
                    <Card className="w-full max-w-md p-6 space-y-4 shadow-xl border-border bg-background">
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
