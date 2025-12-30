import React, { useState, useEffect, useRef } from 'react';
import { sessionAPI, createWebSocket } from '../../api';
import { Button, Input, Card } from '../ui/core';
import { Play, RotateCcw, Check, MessageSquare, AlertTriangle, Terminal, FileText, Send, Maximize2 } from 'lucide-react';
import { Link } from 'react-router-dom';

export function WritingView({ projectId }) {
  const [status, setStatus] = useState('idle');
  const [messages, setMessages] = useState([]);
  const [currentDraft, setCurrentDraft] = useState(null);
  const [review, setReview] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [sessionData, setSessionData] = useState(null);

  const [chapterInfo, setChapterInfo] = useState({
    chapter: 'ch01',
    chapter_title: '',
    chapter_goal: '',
    target_word_count: 3000
  });

  const [isStarted, setIsStarted] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const wsRef = useRef(null);
  const logContainerRef = useRef(null);

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

  const resetSession = () => {
    setIsStarted(false);
    setIsStarting(false);
    setStatus('idle');
    setMessages([]);
    setCurrentDraft(null);
    setReview(null);
    setFeedback('');
    setSessionData(null);
  };

  const startSession = async (e) => {
    e.preventDefault();
    setIsStarting(true);
    setStatus('starting');
    setMessages([]);
    addMessage('user', `INITIATING_SESSION: ${chapterInfo.chapter_title}`);

    try {
      const response = await sessionAPI.start(projectId, chapterInfo);
      setSessionData(response.data);

      if (response.data.success) {
        setIsStarted(true);
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

  const submitFeedback = async (action) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (action === 'confirm') {
        addMessage('system', 'FINALIZING_CHAPTER...');
        setStatus('finalizing');
      }

      const response = await sessionAPI.submitFeedback(projectId, {
        chapter: chapterInfo.chapter,
        feedback: feedback,
        action: action
      });

      if (action === 'confirm') {
        if (response.data?.success) {
          addMessage('system', 'CHAPTER_FINALIZED_SUCCESSFULLY');
          setStatus('completed');
          // Optional: Navigate or reset
        } else {
          addMessage('error', 'FINALIZE_ERROR: ' + (response.data?.error || 'Unknown error'));
          setStatus('waiting_feedback');
        }
      } else {
        addMessage('user', `FEEDBACK_SUBMITTED: ${feedback}`);
        addMessage('system', 'REVISION_IN_PROGRESS...');

        if (response.data.success) {
          setCurrentDraft(response.data.draft);
          addMessage('system', `REVISION_COMPLETE (${response.data.version})`);
          setFeedback('');
        } else {
          addMessage('error', 'REVISION_FAILED: ' + (response.data?.error || 'Unknown error'));
        }
      }
    } catch (error) {
      addMessage('error', 'SUBMISSION_ERROR: ' + (error.response?.data?.detail || error.message));
      if (action === 'confirm') setStatus('waiting_feedback');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-140px)]">
      {/* Left Panel: Control & Logs */}
      <div className="lg:col-span-5 flex flex-col gap-6 overflow-hidden">
        <Card className="flex-shrink-0 bg-surface">
          <div className="p-4 border-b border-border flex justify-between items-center">
            <h3 className="font-medium flex items-center gap-2 text-ink-900">
              <Terminal size={16} /> 会话控制
            </h3>
            <Link to={`/project/${projectId}/session`}>
              <Button size="sm" variant="ghost">
                <Maximize2 size={14} className="mr-2" /> 全屏专注模式
              </Button>
            </Link>
          </div>
          <div className="p-4">
            {!isStarted ? (
              <form onSubmit={startSession} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-ink-500 uppercase">章节ID</label>
                    <Input
                      type="text"
                      value={chapterInfo.chapter}
                      onChange={(e) => setChapterInfo({ ...chapterInfo, chapter: e.target.value })}
                      placeholder="ch01"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-ink-500 uppercase">目标字数</label>
                    <Input
                      type="number"
                      value={chapterInfo.target_word_count}
                      onChange={(e) => setChapterInfo({ ...chapterInfo, target_word_count: parseInt(e.target.value) })}
                      min="500"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-ink-500 uppercase">标题</label>
                  <Input
                    type="text"
                    value={chapterInfo.chapter_title}
                    onChange={(e) => setChapterInfo({ ...chapterInfo, chapter_title: e.target.value })}
                    placeholder="章节标题"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-ink-500 uppercase">目标</label>
                  <textarea
                    value={chapterInfo.chapter_goal}
                    onChange={(e) => setChapterInfo({ ...chapterInfo, chapter_goal: e.target.value })}
                    className="flex min-h-[80px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-ink-400 focus-visible:outline-none focus-visible:border-ink-900"
                    rows="3"
                    placeholder="描述章节目标..."
                    required
                  />
                </div>
                <Button type="submit" disabled={isStarting} className="w-full">
                  {isStarting ? '初始化中...' : '开始会话'}
                </Button>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-3 bg-secondary/10 rounded border border-border">
                  <div className={`h-2.5 w-2.5 rounded-full ${status === 'completed' ? 'bg-green-500' :
                      status === 'error' ? 'bg-red-500' :
                        'bg-blue-500 animate-pulse'
                    }`} />
                  <span className="font-mono text-sm uppercase tracking-wider text-ink-500">
                    状态: <span className="text-ink-900 font-medium">{status}</span>
                  </span>
                </div>

                {status === 'waiting_feedback' && (
                  <div className="space-y-3 pt-2">
                    <textarea
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                      className="flex min-h-[80px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-ink-400 focus-visible:outline-none focus-visible:border-ink-900"
                      rows="3"
                      placeholder="输入修订指令..."
                    />
                    <div className="flex gap-2">
                      <Button onClick={() => submitFeedback('confirm')} disabled={isSubmitting} className="flex-1">
                        <Check size={16} className="mr-2" /> 确认
                      </Button>
                      <Button onClick={() => submitFeedback('revise')} disabled={!feedback.trim() || isSubmitting} variant="outline" className="flex-1">
                        <RotateCcw size={16} className="mr-2" /> 修订
                      </Button>
                    </div>
                  </div>
                )}

                {(status === 'completed' || status === 'error') && (
                  <Button onClick={resetSession} variant="outline" className="w-full">
                    重置会话
                  </Button>
                )}
              </div>
            )}
          </div>
        </Card>

        <Card className="flex-1 overflow-hidden flex flex-col bg-surface">
          <div className="p-3 border-b border-border bg-gray-50/50">
            <h4 className="text-xs font-mono uppercase text-ink-500 flex items-center gap-2">
              <Terminal size={12} /> 系统日志
            </h4>
          </div>
          <div ref={logContainerRef} className="flex-1 bg-background p-4 font-mono text-xs overflow-y-auto space-y-2">
            {messages.length === 0 && <span className="text-ink-400 opacity-50">暂无日志</span>}
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex gap-2 ${msg.type === 'system' ? 'text-blue-600' :
                  msg.type === 'error' ? 'text-red-600' :
                    'text-ink-700'
                }`}>
                <span className="opacity-30 flex-shrink-0 text-ink-400">[{msg.time.toLocaleTimeString()}]</span>
                <span>{msg.type === 'user' ? '>' : '#'} {msg.content}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Right Panel: Content Preview */}
      <div className="lg:col-span-7 overflow-hidden flex flex-col">
        <Card className="h-full flex flex-col bg-surface">
          <div className="flex flex-row items-center justify-between p-4 border-b border-border">
            <h3 className="font-serif font-bold text-lg text-ink-900 flex items-center gap-2">
              <FileText size={18} className="text-ink-500" />
              {chapterInfo.chapter_title || '草稿预览'}
            </h3>
            {currentDraft && <span className="ml-3 text-xs font-mono text-ink-400">{currentDraft.content?.length || 0} 字</span>}
          </div>

          <div className="flex-1 overflow-y-auto p-8 space-y-6">
            {!currentDraft ? (
              <div className="h-full flex flex-col items-center justify-center text-ink-400 opacity-50">
                <Terminal size={48} className="mb-4 stroke-1" />
                <div className="font-serif">等待内容生成...</div>
              </div>
            ) : (
              <>
                <div className="prose prose-slate max-w-none font-serif leading-relaxed text-ink-900">
                  {currentDraft.content}
                </div>

                {review && (
                  <div className="mt-8 border-t border-border pt-6">
                    <h4 className="font-bold text-ink-900 mb-4 flex items-center gap-2">
                      <MessageSquare size={16} className="text-blue-500" /> 审阅分析
                    </h4>
                    <div className="space-y-3">
                      {review.issues?.length > 0 ? (
                        review.issues.map((issue, idx) => (
                          <div key={idx} className={`p-3 rounded border text-sm ${issue.severity === 'critical' ? 'bg-red-50 border-red-200 text-red-700' :
                              issue.severity === 'moderate' ? 'bg-yellow-50 border-yellow-200 text-yellow-700' :
                                'bg-blue-50 border-blue-200 text-blue-700'
                            }`}>
                            <div className="font-bold font-mono text-xs uppercase mb-1 flex items-center gap-2">
                              {issue.severity === 'critical' && <AlertTriangle size={12} />}
                              [{issue.severity}] {issue.category}
                            </div>
                            <div className="opacity-90">{issue.description}</div>
                          </div>
                        ))
                      ) : (
                        <div className="text-green-600 font-mono text-sm flex items-center gap-2">
                          <Check size={14} /> 未检测到问题
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
