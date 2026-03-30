/**
 * AgentStatusPanel - Agent 状态面板（带消息历史和输入框）
 * 
 * 保留对话形式的同时，在 Agent 工作时显示状态卡片
 * - 消息历史记录（用户可追溯修改意见）
 * - 动态 Agent 状态卡片
 * - 底部输入框用于用户交互
 */

import React, { useMemo, useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, Send, Sparkles, Copy, X, Square } from 'lucide-react';
import { useLocale } from '../../i18n';

// 消息项组件
const MessageItem = ({ type, content, time }) => {
    const styles = {
        user: 'bg-[var(--vscode-list-active)] text-[var(--vscode-list-active-fg)] ml-8 border border-[var(--vscode-input-border)]',
        assistant: 'bg-[var(--vscode-input-bg)] text-[var(--vscode-fg)] border border-[var(--vscode-sidebar-border)] mr-8',
        system: 'bg-[var(--vscode-input-bg)] text-[var(--vscode-fg)] border border-[var(--vscode-sidebar-border)] mr-8 font-mono',
        error: 'bg-red-50 text-red-700 border border-red-200 mr-8',
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className={`px-3 py-2 rounded-[6px] text-xs my-1.5 ${styles[type] || styles.system}`}
        >
            {content}
            {time && (
                <span className="ml-2 opacity-50 text-[10px]">
                    {time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                </span>
            )}
        </motion.div>
    );
};

const RunCard = ({
    run,
    expandedTrace,
    onToggleTrace,
    formatStageLabel,
    formatTime,
    formatSource,
}) => {
    const { t } = useLocale();
    const headerTime = run.startedAt ? formatTime(run.startedAt) : '';
    return (
        <div className="border border-[var(--vscode-sidebar-border)] rounded-[6px] bg-[var(--vscode-input-bg)] my-2 overflow-hidden">
            <div className="px-3 py-2 border-b border-[var(--vscode-sidebar-border)] bg-[var(--vscode-sidebar-bg)]">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col gap-1 min-w-0">
                        <div className="text-[10px] text-[var(--vscode-fg-subtle)]">{run.userContent ? t('agentPanel.instruction') : t('agentPanel.systemMsg')}</div>
                        <div className="text-xs text-[var(--vscode-fg)] whitespace-pre-wrap break-words">
                            {run.userContent || t('agentPanel.systemMsg')}
                        </div>
                    </div>
                    {headerTime ? (
                        <div className="text-[10px] text-[var(--vscode-fg-subtle)] whitespace-nowrap">{headerTime}</div>
                    ) : null}
                </div>
            </div>

            {run.messages.length > 0 ? (
                <div className="px-3 py-2">
                    {run.messages.map((msg) => (
                        <MessageItem key={msg.id} type={msg.type} content={msg.content} time={msg.time} />
                    ))}
                </div>
            ) : null}

            {run.progressEvents.length > 0 ? (
                <div className="px-3 pb-3">
                    <div className="text-[10px] text-[var(--vscode-fg-subtle)] mb-1">{t('agentPanel.actionTrace')}</div>
                    <div className="space-y-1">
                        {run.progressEvents.map((event) => {
                            const hasDetails =
                                Boolean(event.note) ||
                                (Array.isArray(event.queries) && event.queries.length > 0) ||
                                typeof event.hits === 'number' ||
                                Boolean(event.stop_reason) ||
                                (Array.isArray(event.top_sources) && event.top_sources.length > 0) ||
                                event.payload !== undefined;
                            const expanded = Boolean(expandedTrace[event.id]);
                            const lineTime = event.timestamp ? formatTime(event.timestamp) : '';

                            return (
                                <div key={event.id} className="text-[10px] text-[var(--vscode-fg-subtle)]">
                                    <button
                                        type="button"
                                        onClick={hasDetails ? () => onToggleTrace(event.id) : undefined}
                                        className={[
                                            "w-full text-left leading-snug",
                                            hasDetails ? "hover:text-[var(--vscode-fg)] cursor-pointer" : "cursor-default"
                                        ].join(' ')}
                                    >
                                        <span className="font-mono opacity-70 mr-2">{lineTime}</span>
                                        <span className="text-[var(--vscode-fg)] font-semibold mr-2">{formatStageLabel(event.stage)}</span>
                                        <span>{event.message || ''}</span>
                                    </button>

                                    {hasDetails && expanded ? (
                                        <div className="mt-1 ml-4 border-l border-[var(--vscode-sidebar-border)] pl-3 space-y-2">
                                            {event.note ? (
                                                <div className="text-[10px] text-[var(--vscode-fg-subtle)] whitespace-pre-wrap break-words">
                                                    {event.note}
                                                </div>
                                            ) : null}

                                            {(Array.isArray(event.queries) && event.queries.length > 0) ? (
                                                <div>
                                                    <div className="text-[10px] text-[var(--vscode-fg-subtle)] mb-1">{t('agentPanel.queries')}</div>
                                                    <div className="flex flex-wrap gap-1">
                                                        {event.queries.map((q, idx) => (
                                                            <span
                                                                key={`${event.id}-q-${idx}`}
                                                                className="px-2 py-0.5 rounded-[6px] border border-[var(--vscode-sidebar-border)] bg-[var(--vscode-bg)] text-[10px] text-[var(--vscode-fg-subtle)]"
                                                            >
                                                                {q}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            ) : null}

                                            {typeof event.hits === 'number' ? (
                                                <div className="text-[10px] text-[var(--vscode-fg-subtle)]">{t('agentPanel.hits').replace('{count}', String(event.hits))}</div>
                                            ) : null}

                                            {(Array.isArray(event.top_sources) && event.top_sources.length > 0) ? (
                                                <div>
                                                    <div className="text-[10px] text-[var(--vscode-fg-subtle)] mb-1">{t('agentPanel.hitSummary')}</div>
                                                    <div className="pt-1 space-y-1">
                                                        {event.top_sources.slice(0, 8).map((source, index) => (
                                                            <div key={`${event.id}-src-${index}`} className="text-[10px]">
                                                                <span className="font-mono">#{index + 1}</span>
                                                                <span className="ml-2">{source.type || 'evidence'}</span>
                                                                <span className="ml-2">{source.snippet}</span>
                                                                {formatSource(source.source) ? (
                                                                    <span className="ml-2 text-[var(--vscode-fg-subtle)]">
                                                                        ({formatSource(source.source)})
                                                                    </span>
                                                                ) : null}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ) : null}

                                            {event.stop_reason ? (
                                                <div className="text-[10px] text-[var(--vscode-fg-subtle)]">{t('agentPanel.stopReason')}：{event.stop_reason}</div>
                                            ) : null}

                                            {event.payload !== undefined ? (
                                                <div>
                                                    <div className="text-[10px] text-[var(--vscode-fg-subtle)] mb-1">{t('agentPanel.details')}</div>
                                                    <div className="bg-[var(--vscode-input-bg)] border border-[var(--vscode-sidebar-border)] rounded-[6px] p-3 max-h-64 overflow-y-auto custom-scrollbar">
                                                        <pre className="text-[10px] text-[var(--vscode-fg-subtle)] font-mono whitespace-pre-wrap break-words">
                                                            {typeof event.payload === 'string' ? event.payload : JSON.stringify(event.payload, null, 2)}
                                                        </pre>
                                                    </div>
                                                </div>
                                            ) : null}
                                        </div>
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : null}
        </div>
    );
};

// 主面板组件
const AgentStatusPanel = ({
    mode = 'create',
    onModeChange = () => { },
    createDisabled = false,
    editDisabled = false,
    inputDisabled = false,
    inputDisabledReason = '',
    selectionCandidateSummary = '',
    selectionAttachedSummary = '',
    selectionCandidateDifferent = false,
    onAttachSelection = () => { },
    onClearAttachedSelection = () => { },
    editScope = 'document',
    onEditScopeChange = () => { },
    contextDebug = null,
    progressEvents = [],
    messages = [],
    memoryPackStatus = null,
    activeChapter = null,
    editContextMode = 'quick',
    onEditContextModeChange = () => { },
    diffReview = null,
    diffDecisions = null,
    onAcceptAllDiff = () => { },
    onRejectAllDiff = () => { },
    onApplySelectedDiff = () => { },
    onSubmit = () => { },
    isGenerating = false,
    isCancelling = false,
    onCancel = () => { },
    className = ''
}) => {
    const [inputValue, setInputValue] = useState('');
    const [copyStatus, setCopyStatus] = useState('');
    const [expandedTrace, setExpandedTrace] = useState({});
    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);
    const { t } = useLocale();

    const runs = useMemo(() => {
        const combined = [];
        messages.forEach((msg, index) => {
            combined.push({
                kind: 'message',
                id: `msg-${index}`,
                ts: msg.time?.getTime?.() || 0,
                msg,
            });
        });
        progressEvents.forEach((event) => {
            combined.push({
                kind: 'progress',
                id: event.id,
                ts: event.timestamp || 0,
                event,
            });
        });
        combined.sort((a, b) => a.ts - b.ts);

        const result = [];
        let current = null;
        let runSeq = 0;

        const ensureRun = (startedAt = 0, userContent = '') => {
            if (current) return current;
            current = {
                id: `run-${runSeq++}`,
                startedAt,
                userContent,
                messages: [],
                progressEvents: [],
            };
            return current;
        };

        combined.forEach((item) => {
            if (item.kind === 'message' && item.msg?.type === 'user') {
                if (current) result.push(current);
                current = {
                    id: `run-${runSeq++}`,
                    startedAt: item.ts,
                    userContent: String(item.msg.content || '').trim(),
                    messages: [],
                    progressEvents: [],
                };
                return;
            }

            const run = ensureRun(item.ts, '');
            if (item.kind === 'message') {
                run.messages.push({
                    id: item.id,
                    type: item.msg.type,
                    content: item.msg.content,
                    time: item.msg.time,
                });
            } else if (item.kind === 'progress') {
                run.progressEvents.push(item.event);
            }
        });

        if (current) result.push(current);
        return result;
    }, [messages, progressEvents]);

    const feedItems = useMemo(() => {
        const runItems = runs.map((run) => ({
            kind: 'run',
            id: run.id,
            ts: run.startedAt || 0,
            run,
        }));
        const contextItems = contextDebug
            ? [{
                kind: 'context',
                id: 'context-debug',
                ts: Number.MAX_SAFE_INTEGER,
                debug: contextDebug,
            }]
            : [];
        return [...runItems, ...contextItems].sort((a, b) => a.ts - b.ts);
    }, [runs, contextDebug]);

    // 自动滚动到底部
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages.length, progressEvents.length, contextDebug, diffReview]);

    const diffSummary = useMemo(() => {
        if (!diffReview?.hunks?.length) return null;
        const total = diffReview.hunks.length;
        const decisions = diffDecisions || {};
        let accepted = 0;
        let rejected = 0;
        let pending = 0;
        diffReview.hunks.forEach((hunk) => {
            const decision = decisions[hunk.id];
            if (decision === 'accepted') accepted += 1;
            else if (decision === 'rejected') rejected += 1;
            else pending += 1;
        });
        return {
            total,
            accepted,
            rejected,
            pending,
            additions: diffReview.stats?.additions || 0,
            deletions: diffReview.stats?.deletions || 0,
        };
    }, [diffReview, diffDecisions]);

    const hasDiffActions = Boolean(diffSummary);
    const hasAnyContent = runs.length > 0 || Boolean(contextDebug) || hasDiffActions;

    const handleSubmit = () => {
        if (inputDisabled) return;
        if (!inputValue.trim()) return;
        onSubmit(inputValue.trim());
        setInputValue('');
        if (inputRef.current) {
            inputRef.current.style.height = 'auto';
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    const updateInputHeight = (el) => {
        if (!el) return;
        el.style.height = 'auto';
        const maxHeight = 160;
        const nextHeight = Math.min(el.scrollHeight, maxHeight);
        el.style.height = `${Math.max(nextHeight, 40)}px`;
        el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
    };

    const handleCopyContextDebug = async () => {
        if (!contextDebug) return;
        const text = typeof contextDebug === 'string' ? contextDebug : JSON.stringify(contextDebug, null, 2);
        if (!navigator?.clipboard?.writeText) {
            window.alert(t('agentPanel.clipboardNotSupported'));
            return;
        }
        try {
            await navigator.clipboard.writeText(text);
            setCopyStatus(t('common.copied'));
            setTimeout(() => setCopyStatus(''), 1500);
        } catch (_error) {
            setCopyStatus(t('common.copyFailed'));
            setTimeout(() => setCopyStatus(''), 2000);
        }
    };

    const toggleTrace = (id) => {
        setExpandedTrace((prev) => ({ ...prev, [id]: !prev[id] }));
    };

    const formatStageLabel = (stage) => {
        return t(`agentPanel.stageLabels.${stage}`) !== `agentPanel.stageLabels.${stage}`
            ? t(`agentPanel.stageLabels.${stage}`)
            : (stage || t('agentPanel.stageLabels.default'));
    };

    const formatSource = (source) => {
        if (!source) return '';
        const parts = [
            source.chapter,
            source.path,
            source.field,
            source.fact_id,
            source.card,
            source.introduced_in,
        ].filter(Boolean);
        return parts.join(' / ');
    };

    const formatTime = (timestamp) => {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };

    const formatBuiltAt = (value) => {
        if (!value) return '';
        const date = new Date(value);
        return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    };

    const memoryPackSummary = useMemo(() => {
        if (!activeChapter) {
            return { label: t('agentPanel.memoryPackNoChapter'), detail: '' };
        }
        if (!memoryPackStatus) {
            return { label: t('agentPanel.memoryPackLoading'), detail: '' };
        }
        if (!memoryPackStatus.exists) {
            return { label: t('agentPanel.memoryPackMissing'), detail: '' };
        }
        const detailParts = [];
        const builtAt = formatBuiltAt(memoryPackStatus.built_at);
        if (builtAt) detailParts.push(t('agentPanel.memoryPackBuiltAt').replace('{time}', builtAt));
        const total = memoryPackStatus?.evidence_stats?.total;
        if (typeof total === 'number') detailParts.push(t('agentPanel.memoryPackEvidence').replace('{count}', String(total)));
        const source = memoryPackStatus?.source;
        if (source) detailParts.push(t('agentPanel.memoryPackSource').replace('{source}', source));
        return {
            label: t('agentPanel.memoryPackReady'),
            detail: detailParts.join(' / ')
        };
    }, [activeChapter, memoryPackStatus, t]);

    return (
        <div className={`flex flex-col h-full ${className}`}>
            <div className="px-3 py-2 border-b border-[var(--vscode-sidebar-border)] bg-[var(--vscode-sidebar-bg)]">
                <div className="text-[11px] text-[var(--vscode-fg)]">{memoryPackSummary.label}</div>
                {memoryPackSummary.detail ? (
                    <div className="text-[10px] text-[var(--vscode-fg-subtle)]">{memoryPackSummary.detail}</div>
                ) : null}
            </div>
            {/* 消息列表（对话 + 行动轨迹） */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-3">
                {!hasAnyContent ? (
                    /* 欢迎提示 */
                        <div className="h-full flex flex-col items-center justify-center text-center p-6">
                        <div className="w-16 h-16 rounded-[6px] bg-[var(--vscode-list-hover)] border border-[var(--vscode-sidebar-border)] flex items-center justify-center mb-4">
                            <Sparkles size={28} className="text-[var(--vscode-focus-border)]" />
                        </div>
                        <h3 className="text-sm font-bold text-[var(--vscode-fg)] mb-2">{t('agentPanel.welcome')}</h3>
                        <p className="text-xs text-[var(--vscode-fg-subtle)] max-w-[200px]">
                            {t('agentPanel.welcomeHint')}
                        </p>
                    </div>
                ) : (
                    <>
                        {feedItems.map((item) => {
                            if (item.kind === 'run') {
                                return (
                                    <RunCard
                                        key={item.id}
                                        run={item.run}
                                        expandedTrace={expandedTrace}
                                        onToggleTrace={toggleTrace}
                                        formatStageLabel={formatStageLabel}
                                        formatTime={formatTime}
                                        formatSource={formatSource}
                                    />
                                );
                            }
                            if (item.kind === 'context') {
                                const expanded = Boolean(expandedTrace[item.id]);
                                return (
                                    <div
                                        key={item.id}
                                        className="border border-[var(--vscode-sidebar-border)] rounded-[6px] bg-[var(--vscode-input-bg)] my-2 overflow-hidden"
                                    >
                                        <button
                                            type="button"
                                            onClick={() => toggleTrace(item.id)}
                                            className="w-full text-left px-3 py-2 flex items-start justify-between gap-2 hover:bg-[var(--vscode-list-hover)]"
                                        >
                                            <div className="flex flex-col gap-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs font-bold text-[var(--vscode-fg)]">{t('agentPanel.workingMemory')}</span>
                                                    <span className="text-[10px] text-[var(--vscode-fg-subtle)]">{t('agentPanel.workingMemoryHint')}</span>
                                                </div>
                                                <div className="text-xs text-[var(--vscode-fg-subtle)]">{t('agentPanel.workingMemoryDesc')}</div>
                                            </div>
                                            <div className="flex items-center gap-2 text-[10px] text-[var(--vscode-fg-subtle)]">
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        handleCopyContextDebug();
                                                    }}
                                                    title={t('agentPanel.copyJson')}
                                                    className="flex items-center gap-1 px-2 py-1 rounded-[6px] border border-[var(--vscode-sidebar-border)] bg-[var(--vscode-input-bg)] hover:border-[var(--vscode-focus-border)]"
                                                >
                                                    <Copy size={12} />
                                                    <span>{copyStatus || t('common.copy')}</span>
                                                </button>
                                                <motion.div
                                                    animate={{ rotate: expanded ? 180 : 0 }}
                                                    transition={{ duration: 0.15 }}
                                                >
                                                    <ChevronDown size={14} />
                                                </motion.div>
                                            </div>
                                        </button>
                                        {expanded && (
                                            <div className="px-3 pb-3">
                                                <div className="bg-[var(--vscode-input-bg)] border border-[var(--vscode-sidebar-border)] rounded-[6px] p-3 max-h-64 overflow-y-auto custom-scrollbar">
                                                    <pre className="text-[10px] text-[var(--vscode-fg-subtle)] font-mono whitespace-pre-wrap break-words">
                                                        {typeof item.debug === 'string' ? item.debug : JSON.stringify(item.debug, null, 2)}
                                                    </pre>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            }

                            return null;
                        })}
                        {hasDiffActions ? (
                            <div className="border border-[var(--vscode-sidebar-border)] rounded-[6px] bg-[var(--vscode-input-bg)] my-2 overflow-hidden">
                                <div className="px-3 py-2 border-b border-[var(--vscode-sidebar-border)] bg-[var(--vscode-sidebar-bg)]">
                                    <div className="flex items-center justify-between">
                                        <div className="text-xs font-bold text-[var(--vscode-fg)]">{t('agentPanel.diffDone')}</div>
                                        <div className="text-[10px] text-[var(--vscode-fg-subtle)]">
                                            {t('agentPanel.diffStats').replace('{add}', diffSummary.additions).replace('{del}', diffSummary.deletions)}
                                        </div>
                                    </div>
                                    <div className="text-[10px] text-[var(--vscode-fg-subtle)] mt-1">
                                        {t('agentPanel.diffSummary').replace('{total}', diffSummary.total).replace('{accepted}', diffSummary.accepted).replace('{rejected}', diffSummary.rejected).replace('{pending}', diffSummary.pending)}
                                    </div>
                                </div>
                                <div className="px-3 py-2 text-[10px] text-[var(--vscode-fg-subtle)]">
                                    {t('agentPanel.diffHint')}
                                </div>
                                <div className="px-3 pb-3 flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={onRejectAllDiff}
                                        className="text-[10px] px-3 py-1.5 rounded-[6px] border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                                    >
                                        {t('agentPanel.rejectAll')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={onAcceptAllDiff}
                                        className="text-[10px] px-3 py-1.5 rounded-[6px] border border-green-200 text-green-700 hover:bg-green-50 transition-colors"
                                    >
                                        {t('agentPanel.acceptAll')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={onApplySelectedDiff}
                                        className="text-[10px] px-3 py-1.5 rounded-[6px] border border-[var(--vscode-input-border)] bg-[var(--vscode-list-active)] text-[var(--vscode-list-active-fg)] hover:opacity-90 transition-colors"
                                    >
                                        {t('agentPanel.applyAccepted')}
                                    </button>
                                </div>
                            </div>
                        ) : null}
                    </>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* 底部输入框 */}
            <div className="flex-shrink-0 p-3 border-t border-[var(--vscode-sidebar-border)] bg-[var(--vscode-sidebar-bg)]">
                <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => onModeChange('create')}
                            disabled={createDisabled || inputDisabled}
                            title={createDisabled ? t('agentPanel.modeWriterTitle') : t('agentPanel.modeWriterHint')}
                            className={[
                                "px-2.5 h-7 text-[11px] rounded-[6px] border transition-colors",
                                mode === 'create'
                                    ? "bg-[var(--vscode-list-active)] text-[var(--vscode-list-active-fg)] border-[var(--vscode-input-border)]"
                                    : "bg-[var(--vscode-input-bg)] text-[var(--vscode-fg)] border-[var(--vscode-sidebar-border)] hover:border-[var(--vscode-focus-border)]",
                                (createDisabled || inputDisabled) ? "opacity-50 cursor-not-allowed" : ""
                            ].join(' ')}
                        >
                        {t('agentPanel.modeWriter')}
                    </button>
                    <button
                        type="button"
                        onClick={() => onModeChange('edit')}
                        title={editDisabled ? t('agentPanel.modeEditorDisabledTitle') : t('agentPanel.modeEditorHint')}
                        disabled={editDisabled || inputDisabled}
                            className={[
                                "px-2.5 h-7 text-[11px] rounded-[6px] border transition-colors",
                                mode === 'edit'
                                    ? "bg-[var(--vscode-list-active)] text-[var(--vscode-list-active-fg)] border-[var(--vscode-input-border)]"
                                    : "bg-[var(--vscode-input-bg)] text-[var(--vscode-fg)] border-[var(--vscode-sidebar-border)] hover:border-[var(--vscode-focus-border)]",
                                (editDisabled || inputDisabled) ? "opacity-50 cursor-not-allowed" : ""
                            ].join(' ')}
                        >
                        {t('agentPanel.modeEditor')}
                    </button>
                    {mode === 'edit' ? (
                        <div className="ml-2 flex items-center gap-1">
                            <button
                                type="button"
                                onClick={() => onEditContextModeChange('quick')}
                                title={t('agentPanel.contextQuickHint')}
                                disabled={inputDisabled}
                                className={[
                                    "px-2 h-7 text-[11px] rounded-[6px] border transition-colors",
                                    editContextMode === 'quick'
                                        ? "bg-[var(--vscode-list-active)] text-[var(--vscode-list-active-fg)] border-[var(--vscode-input-border)]"
                                        : "bg-[var(--vscode-input-bg)] text-[var(--vscode-fg)] border-[var(--vscode-sidebar-border)] hover:border-[var(--vscode-focus-border)]",
                                    inputDisabled ? "opacity-50 cursor-not-allowed" : ""
                                ].join(' ')}
                            >
                                {t('agentPanel.contextQuick')}
                            </button>
                            <button
                                type="button"
                                onClick={() => onEditContextModeChange('full')}
                                title={t('agentPanel.contextFullHint')}
                                disabled={inputDisabled}
                                className={[
                                    "px-2 h-7 text-[11px] rounded-[6px] border transition-colors",
                                    editContextMode === 'full'
                                        ? "bg-[var(--vscode-list-active)] text-[var(--vscode-list-active-fg)] border-[var(--vscode-input-border)]"
                                        : "bg-[var(--vscode-input-bg)] text-[var(--vscode-fg)] border-[var(--vscode-sidebar-border)] hover:border-[var(--vscode-focus-border)]",
                                    inputDisabled ? "opacity-50 cursor-not-allowed" : ""
                                ].join(' ')}
                            >
                                {t('agentPanel.contextFull')}
                            </button>
                        </div>
                    ) : null}
                </div>
                <span className="text-[10px] text-[var(--vscode-fg-subtle)]">
                    {mode === 'edit' ? t('agentPanel.modeTagDiff') : t('agentPanel.modeTagStream')}
                </span>
                </div>
                {mode === 'edit' ? (
                    <div className="flex items-center justify-between mb-2 gap-2">
                        <div className="text-[10px] text-[var(--vscode-fg-subtle)]">
                            {selectionCandidateSummary || t('agentPanel.noSelection')}
                        </div>
                        {selectionCandidateSummary ? (
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    disabled={inputDisabled}
                                    onClick={() => onEditScopeChange('document')}
                                    className={[
                                        "px-2 h-6 text-[10px] rounded-[6px] border transition-colors",
                                        editScope === 'document'
                                            ? "bg-[var(--vscode-list-active)] text-[var(--vscode-list-active-fg)] border-[var(--vscode-input-border)]"
                                            : "bg-[var(--vscode-input-bg)] text-[var(--vscode-fg)] border-[var(--vscode-sidebar-border)] hover:border-[var(--vscode-focus-border)]",
                                        inputDisabled ? "opacity-50 cursor-not-allowed" : ""
                                    ].join(' ')}
                                    title={t('agentPanel.scopeDocumentHint')}
                                >
                                    {t('agentPanel.scopeDocument')}
                                </button>
                                <button
                                    type="button"
                                    disabled={inputDisabled || !selectionAttachedSummary}
                                    onClick={() => onEditScopeChange('selection')}
                                    className={[
                                        "px-2 h-6 text-[10px] rounded-[6px] border transition-colors",
                                        editScope === 'selection'
                                            ? "bg-[var(--vscode-list-active)] text-[var(--vscode-list-active-fg)] border-[var(--vscode-input-border)]"
                                            : "bg-[var(--vscode-input-bg)] text-[var(--vscode-fg)] border-[var(--vscode-sidebar-border)] hover:border-[var(--vscode-focus-border)]",
                                        (inputDisabled || !selectionAttachedSummary) ? "opacity-50 cursor-not-allowed" : ""
                                    ].join(' ')}
                                    title={selectionAttachedSummary ? t('agentPanel.scopeSelectionHint') : t('agentPanel.scopeSelectionDisabledHint')}
                                >
                                    {t('agentPanel.scopeSelection')}
                                </button>
                                <button
                                    type="button"
                                    disabled={inputDisabled || (selectionAttachedSummary && !selectionCandidateDifferent)}
                                    onClick={onAttachSelection}
                                    className={[
                                        "px-2 h-6 text-[10px] rounded-[6px] border transition-colors",
                                        "bg-[var(--vscode-input-bg)] text-[var(--vscode-fg)] border-[var(--vscode-sidebar-border)] hover:border-[var(--vscode-focus-border)]",
                                        (inputDisabled || (selectionAttachedSummary && !selectionCandidateDifferent)) ? "opacity-50 cursor-not-allowed" : ""
                                    ].join(' ')}
                                    title={t('agentPanel.scopeDocumentHint')}
                                >
                                    {selectionAttachedSummary ? (selectionCandidateDifferent ? t('agentPanel.replaceSelection') : t('agentPanel.selectionAttached')) : t('agentPanel.attachSelection')}
                                </button>
                            </div>
                        ) : null}
                    </div>
                ) : null}
                {mode === 'edit' && selectionAttachedSummary ? (
                    <div className="flex items-center justify-between mb-2 gap-2">
                        <div className="text-[10px] px-2 py-1 rounded-[6px] border border-[var(--vscode-sidebar-border)] bg-[var(--vscode-input-bg)] text-[var(--vscode-fg-subtle)]">
                            {selectionAttachedSummary}
                        </div>
                        <button
                            type="button"
                            disabled={inputDisabled}
                            onClick={onClearAttachedSelection}
                            className={[
                                "p-1 rounded-[6px] border border-[var(--vscode-sidebar-border)] bg-[var(--vscode-input-bg)] text-[var(--vscode-fg-subtle)] hover:text-[var(--vscode-fg)] hover:border-[var(--vscode-focus-border)] transition-colors",
                                inputDisabled ? "opacity-50 cursor-not-allowed" : ""
                            ].join(' ')}
                            title={t('agentPanel.clearSelection')}
                            aria-label={t('agentPanel.clearSelection')}
                        >
                            <X size={14} />
                        </button>
                    </div>
                ) : null}
                <div className="flex flex-col gap-2">
                    {inputDisabled && inputDisabledReason ? (
                        <div className="text-[10px] text-[var(--vscode-fg-subtle)] border border-[var(--vscode-sidebar-border)] bg-[var(--vscode-input-bg)] rounded-[6px] px-3 py-2">
                            {inputDisabledReason}
                        </div>
                    ) : null}
                    <div className="flex gap-2">
                        <textarea
                            ref={inputRef}
                            rows={1}
                            value={inputValue}
                            onChange={(e) => {
                                setInputValue(e.target.value);
                                updateInputHeight(e.target);
                            }}
                            onKeyDown={handleKeyDown}
                            onFocus={(e) => updateInputHeight(e.target)}
                            disabled={inputDisabled}
                            placeholder={mode === 'edit' ? t('agentPanel.inputPlaceholderEdit') : t('agentPanel.inputPlaceholderCreate')}
                            className={[
                                "flex-1 px-3 py-2 text-sm border border-[var(--vscode-input-border)] rounded-[6px] bg-[var(--vscode-input-bg)] text-[var(--vscode-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--vscode-focus-border)] focus:border-[var(--vscode-focus-border)] resize-none min-h-[40px] overscroll-contain",
                                inputDisabled ? "opacity-60 cursor-not-allowed" : ""
                            ].join(' ')}
                        />
                        {isGenerating ? (
                            <button
                                onClick={onCancel}
                                disabled={isCancelling}
                                title={t('agentPanel.cancelGeneration')}
                                className="px-3 h-10 bg-red-500/10 text-red-600 rounded-[6px] border border-red-300/50 hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {isCancelling ? (
                                    <motion.div
                                        animate={{ rotate: 360 }}
                                        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                                        className="w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full"
                                    />
                                ) : (
                                    <Square size={16} />
                                )}
                            </button>
                        ) : (
                            <button
                                onClick={handleSubmit}
                                disabled={inputDisabled || !inputValue.trim()}
                                className="px-3 h-10 bg-[var(--vscode-list-active)] text-[var(--vscode-list-active-fg)] rounded-[6px] border border-[var(--vscode-input-border)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                <Send size={16} />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AgentStatusPanel;
