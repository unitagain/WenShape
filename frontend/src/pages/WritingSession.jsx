import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { sessionAPI, createWebSocket } from '../api';
import { Button, Input, Card } from '../components/ui/core';
import { WritingCanvas } from '../components/writing/WritingCanvas';
import { WritingSidebar } from '../components/writing/WritingSidebar';
import {
  Play, RotateCcw, Check, MessageSquare, AlertTriangle,
  Terminal, Sparkles, Save, ChevronLeft, Bot, PanelRight
} from 'lucide-react';

function WritingSession() {
  const { projectId } = useParams();
  const navigate = useNavigate();

  // UI State
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showStartModal, setShowStartModal] = useState(true);

  // Logic State (Migrated from WritingView)
  const [status, setStatus] = useState('idle');
  const [messages, setMessages] = useState([]);
  const [currentDraft, setCurrentDraft] = useState(null);
  const [review, setReview] = useState(null);
  const [feedback, setFeedback] = useState('');

  const [chapterInfo, setChapterInfo] = useState({
    chapter: 'ch01',
    chapter_title: '',
    chapter_goal: '',
    target_word_count: 3000
  });

  const [isStarting, setIsStarting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const wsRef = useRef(null);
  const logContainerRef = useRef(null);

  // --- Logic Implementation ---

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
    setIsStarting(true);
    setStatus('starting');
    setMessages([]);
    setShowStartModal(false); // Hide modal, show paper

    try {
      const response = await sessionAPI.start(projectId, chapterInfo);

      if (response.data.success) {
        setCurrentDraft(response.data.draft_v2);
        setReview(response.data.review);
        setStatus('waiting_feedback');
      } else {
        addMessage('error', 'SESSION_START_FAILED: ' + response.data.error);
        setStatus('error');
        setShowStartModal(true); // Re-show modal on error
      }
    } catch (error) {
      addMessage('error', 'SYSTEM_ERROR: ' + (error.response?.data?.detail || error.message));
      setStatus('error');
      setShowStartModal(true);
    } finally {
      setIsStarting(false);
    }
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
          alert("Chapter Finalized!");
        } else {
          setStatus('waiting_feedback');
        }
      } else {
        if (response.data.success) {
          setCurrentDraft(response.data.draft);
          setFeedback('');
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
      <header className="absolute top-0 left-0 right-0 h-16 pointer-events-none z-10 flex items-center justify-between px-6">
        <div className="pointer-events-auto">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/project/${projectId}`)}>
            <ChevronLeft className="mr-2 h-4 w-4" /> 返回
          </Button>
        </div>
        <div className="pointer-events-auto">
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <PanelRight className="text-primary" /> : <PanelRight />}
          </Button>
        </div>
      </header>

      {/* Main Canvas */}
      <WritingCanvas className="pt-20">
        {!currentDraft ? (
          <div className="h-[60vh] flex flex-col items-center justify-center text-ink-400">
            {status === 'starting' ? (
              <div className="animate-pulse flex flex-col items-center">
                <Sparkles className="h-8 w-8 mb-4 text-primary" />
                <p className="font-serif italic">正在构思章节灵感...</p>
              </div>
            ) : (
              <div className="text-center">
                <h1 className="text-4xl font-serif font-bold text-ink-900 mb-4">{chapterInfo.chapter_title || "无标题"}</h1>
                <p className="font-sans text-sm text-ink-500">点击右侧侧边栏开始写作会话</p>
              </div>
            )}
          </div>
        ) : (
          <div className="animate-fade-in">
            <h1 className="text-4xl font-serif font-bold text-ink-900 mb-8 border-b border-border pb-4">
              {chapterInfo.chapter_title}
            </h1>
            <div className="whitespace-pre-wrap leading-loose text-lg">
              {currentDraft.content}
            </div>
          </div>
        )}
      </WritingCanvas>

      {/* AI Sidebar */}
      <WritingSidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        title="AI 助手"
        icon={Bot}
      >
        {/* Start Form */}
        {status === 'idle' && (
          <div className="space-y-4">
            <div className="p-3 bg-primary-light rounded-md text-xs text-ink-500 mb-4">
              配置当前章节的写作目标，AI 将协助你完成初稿。
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase text-ink-500">章节 ID & 标题</label>
              <div className="flex gap-2">
                <Input
                  value={chapterInfo.chapter}
                  onChange={e => setChapterInfo({ ...chapterInfo, chapter: e.target.value })}
                  className="w-20 font-mono"
                />
                <Input
                  value={chapterInfo.chapter_title}
                  onChange={e => setChapterInfo({ ...chapterInfo, chapter_title: e.target.value })}
                  placeholder="例如: 觉醒"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase text-ink-500">本章目标</label>
              <textarea
                className="flex min-h-[100px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary"
                value={chapterInfo.chapter_goal}
                onChange={e => setChapterInfo({ ...chapterInfo, chapter_goal: e.target.value })}
                placeholder="描述本章发生的核心事件..."
              />
            </div>
            <Button className="w-full" onClick={startSession} disabled={isStarting}>
              {isStarting ? <Sparkles className="animate-spin mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
              开始生成
            </Button>
          </div>
        )}

        {/* Feedback Loop */}
        {(status === 'waiting_feedback' || status === 'completed') && (
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase text-ink-500">修订指令</label>
              <textarea
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                className="flex min-h-[100px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary"
                placeholder="例如: 这一段太啰嗦了，让对话更紧张一点..."
              />
              <div className="flex gap-2">
                <Button onClick={() => submitFeedback('confirm')} disabled={isSubmitting} className="flex-1">
                  <Check size={14} className="mr-2" /> 确认/完成
                </Button>
                <Button onClick={() => submitFeedback('revise')} disabled={!feedback.trim() || isSubmitting} variant="outline" className="flex-1">
                  <RotateCcw size={14} className="mr-2" /> 修订
                </Button>
              </div>
            </div>

            {/* Review Issues */}
            {review?.issues?.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-bold text-sm text-ink-900 flex items-center gap-2">
                  <AlertTriangle size={14} className="text-yellow-500" /> 潜在问题
                </h4>
                {review.issues.map((issue, idx) => (
                  <div key={idx} className="text-xs p-2 bg-yellow-50 rounded border border-yellow-100 text-yellow-800">
                    <span className="font-bold">[{issue.category}]</span> {issue.description}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Logs Console */}
        <div className="mt-8 border-t border-border pt-4">
          <div className="flex items-center gap-2 mb-2 text-xs font-mono text-ink-400">
            <Terminal size={12} />
            SYSTEM_LOGS
          </div>
          <div ref={logContainerRef} className="h-32 overflow-y-auto bg-gray-50 p-2 rounded text-[10px] font-mono space-y-1 text-ink-500">
            {messages.map((m, i) => (
              <div key={i}>
                <span className="opacity-50">[{m.time.toLocaleTimeString()}]</span> {m.content}
              </div>
            ))}
          </div>
        </div>

      </WritingSidebar>
    </div>
  );
}

export default WritingSession;
