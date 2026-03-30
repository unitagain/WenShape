/**
 * 文枢 WenShape - 深度上下文感知的智能体小说创作系统
 * WenShape - Deep Context-Aware Agent-Based Novel Writing System
 *
 * Copyright © 2025-2026 WenShape Team
 * License: PolyForm Noncommercial License 1.0.0
 *
 * 模块说明 / Module Description:
 *   编排器控制台面板 - 交互式调试界面，用于测试智能体工作流和手动执行编排任务
 *   Orchestrator console panel for interactive debugging and manual workflow testing.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
    Send, RotateCcw, Save, Sparkles,
    Bot, Database, Layers, Radio, AlignLeft,
    CheckCircle2, AlertCircle, Terminal
} from 'lucide-react';
import { motion } from 'framer-motion';
import { cn, Button } from '../../ui/core';
import { useLocale } from '../../../i18n';

/**
 * 编排器控制台面板 - 编排工作流的交互式调试工具
 *
 * Interactive console for orchestrator debugging and testing. Allows users to send
 * commands to agents, view responses, and monitor execution logs.
 *
 * @component
 * @example
 * return (
 *   <OrchestratorConsole />
 * )
 *
 * @returns {JSX.Element} 编排器控制台元素 / Orchestrator console element
 */

const INPUT_MAX_LENGTH = 10000;
const MESSAGE_COLLAPSE_LENGTH = 500;
const VISIBLE_MESSAGES_LIMIT = 50;

const ConsoleMessage = ({ msg }) => {
    const { t } = useLocale();
    const isUser = msg.type === 'user';
    const isSystem = msg.type === 'system';
    const isError = msg.type === 'error';

    const content = String(msg.content || '');
    const isLong = content.length > MESSAGE_COLLAPSE_LENGTH;
    const [expanded, setExpanded] = useState(false);
    const displayContent = isLong && !expanded
        ? content.slice(0, MESSAGE_COLLAPSE_LENGTH) + '...'
        : content;

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
                "flex gap-3 mb-4 w-full",
                isUser ? "flex-row-reverse" : "flex-row"
            )}
        >
            {/* Avatar */}
            <div className={cn(
                "w-8 h-8 rounded-[6px] flex items-center justify-center shrink-0 border",
                isUser ? "bg-[var(--vscode-list-active)] border-[var(--vscode-input-border)] text-[var(--vscode-list-active-fg)]" :
                    isSystem ? "bg-[var(--vscode-input-bg)] border-[var(--vscode-sidebar-border)] text-[var(--vscode-fg)]" :
                        "bg-red-50 border-red-100 text-red-500"
            )}>
                {isUser ? <div className="i-lucide-user scale-90" /> :
                    isError ? <AlertCircle size={16} /> :
                        <Terminal size={16} />}
            </div>

            {/* Bubble */}
            <div className={cn(
                "flex flex-col max-w-[85%]",
                isUser ? "items-end" : "items-start"
            )}>
                <div className={cn(
                    "px-4 py-2.5 rounded-[6px] text-sm leading-relaxed whitespace-pre-wrap border",
                    isUser ? "bg-[var(--vscode-list-active)] text-[var(--vscode-list-active-fg)] border-[var(--vscode-input-border)]" :
                        isSystem ? "bg-[var(--vscode-input-bg)] border-[var(--vscode-sidebar-border)] text-[var(--vscode-fg)] rounded-tl-sm font-mono text-xs" :
                            "bg-red-50 border-red-100 text-red-600"
                )}>
                    {displayContent}
                    {isLong && (
                        <button
                            type="button"
                            onClick={() => setExpanded(!expanded)}
                            className="ml-1 text-[var(--vscode-focus-border)] hover:underline text-xs"
                        >
                            {expanded ? t('common.collapse') : t('common.expand')}
                        </button>
                    )}
                </div>
                <span className="text-[10px] text-[var(--vscode-fg-subtle)] mt-1 px-1">
                    {new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
            </div>
        </motion.div >
    );
};

const ContextStep = ({ step, status }) => {
    const { t } = useLocale();
    // status: 'waiting', 'processing', 'done', 'error'
    const icons = {
        analysis: <AlignLeft size={14} />,
        retrieval: <Database size={14} />,
        planning: <Layers size={14} />,
        execution: <Bot size={14} />
    };

    const labels = {
        analysis: t('panels.console.stepAnalysis'),
        retrieval: t('panels.console.stepRetrieval'),
        planning: t('panels.console.stepPlanning'),
        execution: t('panels.console.stepExecution'),
    };

    return (
        <div className={cn(
            "flex items-center gap-2 text-xs py-1 px-2 rounded transition-colors",
            status === 'processing' ? "text-[var(--vscode-fg)] bg-[var(--vscode-list-hover)]" :
                status === 'done' ? "text-emerald-600" : "text-[var(--vscode-fg-subtle)]"
        )}>
            {status === 'processing' && <Sparkles size={12} className="animate-spin" />}
            {status === 'done' && <CheckCircle2 size={12} />}
            {!['processing', 'done'].includes(status) && <div className="w-3 h-3 rounded-full border border-current" />}

            <span className="flex items-center gap-1.5 font-mono">
                {icons[step] || <Radio size={12} />}
                {labels[step] || step}
            </span>
        </div>
    );
};

const OrchestratorStatus = ({ status, chapter, isGenerating }) => {
    const { t } = useLocale();
    // Visible state of the orchestration engine
    return (
        <div className="mb-4 p-3 bg-[var(--vscode-bg)] border border-[var(--vscode-sidebar-border)] rounded-[6px] shadow-none">
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-[var(--vscode-sidebar-border)]">
                <div className="flex items-center gap-2">
                    <div className={cn(
                        "w-2 h-2 rounded-full animate-pulse",
                        isGenerating ? "bg-[var(--vscode-focus-border)]" : "bg-emerald-500"
                    )} />
                    <span className="text-xs font-bold text-[var(--vscode-fg)] tracking-wide">
                        {t('panels.console.systemHub')}
                    </span>
                </div>
                {chapter && (
                    <span className="text-[10px] font-mono text-[var(--vscode-fg-subtle)] bg-[var(--vscode-input-bg)] px-1.5 py-0.5 rounded-[4px] border border-[var(--vscode-sidebar-border)]">
                        {t('panels.console.targetChapter').replace('{chapter}', chapter)}
                    </span>
                )}
            </div>

            {isGenerating ? (
                <div className="space-y-1">
                    <ContextStep step="analysis" status="done" />
                    <ContextStep step="retrieval" status="done" />
                    <ContextStep step="planning" status="processing" />
                    <ContextStep step="execution" status="waiting" />
                </div>
            ) : status === 'idle' ? (
                <div className="text-xs text-[var(--vscode-fg-subtle)] flex items-center gap-2 py-1 px-2">
                    <Radio size={14} />
                    {t('panels.console.idleMsg')}
                </div>
            ) : (
                <div className="text-xs text-[var(--vscode-fg)] flex items-center gap-2 py-1 px-2">
                    <CheckCircle2 size={14} className="text-emerald-500" />
                    {t('panels.console.completedMsg')}
                </div>
            )}
        </div>
    );
};

const QuickActions = ({ status, chapter, isGenerating, onStart, onSelectChapter, onSave, isSaving }) => {
    const { t } = useLocale();
    if (isGenerating) return null;

    return (
        <div className="flex flex-col gap-2 mb-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {!chapter ? (
                <div className="p-4 bg-[var(--vscode-bg)] border border-dashed border-[var(--vscode-sidebar-border)] rounded-[6px] text-center">
                    <p className="text-sm text-[var(--vscode-fg-subtle)] mb-3">{t('panels.console.noContext')}</p>
                    <Button onClick={onSelectChapter} className="w-full" variant="outline">
                        {t('panels.console.selectOrCreate')}
                    </Button>
                </div>
            ) : status === 'editing' ? (
                <div className="grid grid-cols-2 gap-2">
                    <Button onClick={onSave} disabled={isSaving} variant="default" className="w-full">
                        <Save size={14} className="mr-2" />
                        {isSaving ? t('panels.console.saving') : t('panels.console.saveDraft')}
                    </Button>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-2">
                    <button
                        onClick={() => onStart('fast')}
                        className="flex items-center gap-3 p-3 bg-[var(--vscode-bg)] border border-[var(--vscode-sidebar-border)] rounded-[6px] hover:bg-[var(--vscode-list-hover)] transition-colors text-left group"
                    >
                        <div className="p-2 bg-blue-50 text-blue-500 rounded-[6px]">
                            <RotateCcw size={18} />
                        </div>
                        <div>
                            <div className="text-xs font-bold text-[var(--vscode-fg)]">{t('panels.console.quickGenerate')}</div>
                            <div className="text-[10px] text-[var(--vscode-fg-subtle)]">{t('panels.console.quickGenerateDesc')}</div>
                        </div>
                    </button>

                    <button
                        onClick={() => onStart('deep')}
                        className="flex items-center gap-3 p-3 bg-[var(--vscode-bg)] border border-[var(--vscode-sidebar-border)] rounded-[6px] hover:bg-[var(--vscode-list-hover)] transition-colors text-left group"
                    >
                        <div className="p-2 bg-purple-50 text-purple-500 rounded-[6px]">
                            <Sparkles size={18} />
                        </div>
                        <div>
                            <div className="text-xs font-bold text-[var(--vscode-fg)]">{t('panels.console.deepCreate')}</div>
                            <div className="text-[10px] text-[var(--vscode-fg-subtle)]">{t('panels.console.deepCreateDesc')}</div>
                        </div>
                    </button>
                </div>
            )}
        </div>
    );
};

export const OrchestratorConsole = ({
    status,
    messages,
    chapterInfo,
    chapters,
    isGenerating,
    isSaving,
    onStart,
    onSelectChapter,
    onSubmitFeedback,
    onManualSave,
    onResetStatus: _onResetStatus
}) => {
    /**
     * 运行态展示与交互输入区域
     * 不改变消息处理逻辑。
     */
    const { t } = useLocale();
    const [input, setInput] = useState('');
    const scrollRef = useRef(null);

    // Auto-scroll
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isGenerating, status]);

    const handleSend = () => {
        if (!input.trim()) return;

        if (status === 'waiting_feedback') {
            onSubmitFeedback(input);
        } else {
            // General chat handling (currently just echo or log)
            // In a real system, this would go to the Orchestrator LLM
            // For now, we mainly use it for feedback or just logging user intent
            onSubmitFeedback(input); // Re-use feedback channel effectively acts as "User Input"
        }
        setInput('');
    };

    return (
        <div className="flex flex-col h-full bg-[var(--vscode-bg)] text-[var(--vscode-fg)]">
            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar" ref={scrollRef}>

                {/* 1. System Status */}
                <OrchestratorStatus
                    status={status}
                    chapter={chapterInfo.chapter}
                    isGenerating={isGenerating}
                />

                {/* 2. Message Stream — only render the most recent messages */}
                <div className="space-y-2">
                    {(messages.length > VISIBLE_MESSAGES_LIMIT ? messages.slice(-VISIBLE_MESSAGES_LIMIT) : messages).map((m, i) => (
                        <ConsoleMessage key={i} msg={m} />
                    ))}
                </div>

                {/* 3. Dynamic Controls */}
                <QuickActions
                    status={status}
                    chapter={chapterInfo.chapter}
                    isGenerating={isGenerating}
                    onStart={onStart}
                    onSelectChapter={onSelectChapter}
                    chapters={chapters}
                    onSave={onManualSave}
                    isSaving={isSaving}
                />
            </div>

            {/* Input Area */}
            <div className="p-4 bg-[var(--vscode-sidebar-bg)] border-t border-[var(--vscode-sidebar-border)]">
                <div className="relative flex items-end gap-2">
                    <div className="flex-1 relative">
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSend();
                                }
                            }}
                            maxLength={INPUT_MAX_LENGTH}
                            placeholder={
                                status === 'waiting_feedback' ? t('panels.console.placeholderFeedback') :
                                    t('panels.console.placeholderInput')
                            }
                            className="w-full min-h-[44px] max-h-[120px] py-3 pl-4 pr-10 bg-[var(--vscode-input-bg)] border border-[var(--vscode-input-border)] rounded-[6px] text-sm focus:ring-1 focus:ring-[var(--vscode-focus-border)] focus:border-[var(--vscode-focus-border)] resize-none overflow-y-auto outline-none transition-colors placeholder:text-[var(--vscode-fg-subtle)] font-sans"
                            disabled={isGenerating}
                        />
                        <div className="absolute right-2 bottom-2">
                            <Button
                                size="icon"
                                className="h-7 w-7 rounded-[6px]"
                                onClick={handleSend}
                                disabled={!input.trim() || isGenerating}
                            >
                                <Send size={14} />
                            </Button>
                        </div>
                    </div>
                </div>
                <div className="flex justify-between items-center mt-2 px-1">
                    <span className="text-[10px] text-[var(--vscode-fg-subtle)] font-mono">
                        {t('panels.console.engineVersion')}
                    </span>
                    <div className="flex items-center gap-3">
                        <span className={cn(
                            "text-[10px] tabular-nums",
                            input.length > INPUT_MAX_LENGTH * 0.9
                                ? "text-red-500"
                                : input.length > INPUT_MAX_LENGTH * 0.7
                                    ? "text-amber-500"
                                    : "text-[var(--vscode-fg-subtle)]"
                        )}>
                            {input.length > 0 && `${input.length}/${INPUT_MAX_LENGTH}`}
                        </span>
                        <span className="text-[10px] text-[var(--vscode-fg-subtle)]">
                            {status === 'idle'
                                ? t('panels.console.statusIdle')
                                : status === 'starting'
                                    ? t('panels.console.statusStarting')
                                    : status === 'editing'
                                        ? t('panels.console.statusEditing')
                                        : status === 'waiting_feedback'
                                            ? t('panels.console.statusWaitingFeedback')
                                            : status === 'completed'
                                                ? t('panels.console.statusCompleted')
                                                : status}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OrchestratorConsole;
