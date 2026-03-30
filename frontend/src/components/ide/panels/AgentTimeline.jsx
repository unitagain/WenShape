/**
 * AgentTimeline - Agent 执行时间线
 * 可视化展示多 Agent 协作过程（回合制分组）。
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocale } from '../../../i18n';

// --- 本地化映射 ---

const AGENT_COLORS = {
    archivist: '#8b5cf6', // Indigo/Purple
    writer: '#3b82f6',    // Blue
    editor: '#10b981',    // Emerald
    orchestrator: '#64748b' // Slate
};

const EVENT_ICONS = {
    agent_start: '🚀',
    agent_end: '✅',
    agent_error: '❌',
    context_select: '🧠',
    context_compress: '🗜️',
    context_health_check: '🏥',
    tool_call: '🛠️',
    tool_result: '📤',
    llm_request: '✨',
    handoff: '🤝',
    diff_generated: '📝'
};

// --- 事件分组逻辑 ---

const groupEventsByTurn = (events) => {
    const turns = [];
    let currentTurn = null;

    events.forEach(event => {
        // 1. 开启新回合
        if (event.type === 'agent_start') {
            if (currentTurn) turns.push(currentTurn); // 结束上一回合
            currentTurn = {
                id: `turn_${event.id}`,
                agent: event.agent_name,
                startTime: event.timestamp,
                status: 'running',
                events: [event],
                metrics: { tokens: 0, diffs: 0, tools: 0 }
            };
        }
        // 2. 结束当前回合
        else if (event.type === 'agent_end' || event.type === 'agent_error') {
            if (currentTurn) {
                currentTurn.events.push(event);
                currentTurn.status = event.type === 'agent_end' ? 'completed' : 'failed';
                currentTurn.endTime = event.timestamp;
                currentTurn.duration = (currentTurn.endTime - currentTurn.startTime).toFixed(1);
                turns.push(currentTurn);
                currentTurn = null;
            } else {
                // 异常结束事件（理论上不应出现）
                turns.push({
                    id: `orphan_${event.id}`,
                    agent: event.agent_name,
                    status: event.type === 'agent_end' ? 'completed' : 'failed',
                    events: [event],
                    metrics: { tokens: 0, diffs: 0, tools: 0 }
                });
            }
        }
        // 3. 向当前回合追加事件
        else if (currentTurn) {
            currentTurn.events.push(event);

            // 更新统计
            if (event.type === 'llm_request') {
                currentTurn.metrics.tokens += (event.data.tokens?.total || 0);
            }
            if (event.type === 'diff_generated') {
                currentTurn.metrics.diffs += (event.data.additions + event.data.deletions);
            }
            if (event.type === 'tool_call') {
                currentTurn.metrics.tools += 1;
            }
        }
        // 4. 独立事件（例如回合外 handoff）
        else {
            // handoff 作为分隔符
            if (event.type === 'handoff') {
                turns.push({
                    id: `handoff_${event.id}`,
                    type: 'separator',
                    data: event
                });
            }
        }
    });

    // 收尾未结束回合
    if (currentTurn) turns.push(currentTurn);

    return turns;
};

// --- 子组件 ---

const HandoffSeparator = ({ data }) => {
    const { t } = useLocale();
    const AGENT_NAMES = {
        archivist: t('panels.timeline.agentArchivist'),
        writer: t('panels.timeline.agentWriter'),
        editor: t('panels.timeline.agentEditor'),
        orchestrator: t('panels.timeline.agentOrchestrator'),
    };
    return (
    <div className="flex items-center justify-center my-4 opacity-70">
        <div className="h-[1px] bg-[var(--vscode-sidebar-border)] flex-1 mx-4" />
        <div className="flex items-center gap-2 text-[10px] text-[var(--vscode-fg-subtle)] bg-[var(--vscode-bg)] px-3 py-1 rounded-full border border-[var(--vscode-sidebar-border)]">
            <span>{AGENT_NAMES[data.agent_name] || data.agent_name}</span>
            <span>→</span>
            <span>{AGENT_NAMES[data.data.to] || data.data.to}</span>
        </div>
        <div className="h-[1px] bg-[var(--vscode-sidebar-border)] flex-1 mx-4" />
    </div>
    );
};

const TurnCard = ({ turn, expanded, onToggle }) => {
    const { t } = useLocale();
    const AGENT_NAMES = {
        archivist: t('panels.timeline.agentArchivist'),
        writer: t('panels.timeline.agentWriter'),
        editor: t('panels.timeline.agentEditor'),
        orchestrator: t('panels.timeline.agentOrchestrator'),
    };
    const agentColor = AGENT_COLORS[turn.agent] || '#6b7280';
    const localizedName = AGENT_NAMES[turn.agent] || turn.agent;

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-[var(--vscode-bg)] border border-[var(--vscode-sidebar-border)] rounded-[6px] overflow-hidden shadow-none"
            style={{ borderLeft: `4px solid ${agentColor}` }}
        >
            {/* Header */}
            <div
                onClick={onToggle}
                className="p-3 flex items-center justify-between cursor-pointer bg-[var(--vscode-sidebar-bg)] hover:bg-[var(--vscode-list-hover)] transition-colors"
                title={t('panels.timeline.expandDetails')}
            >
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: agentColor }}>
                        {localizedName[0]}
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-[var(--vscode-fg)]">{localizedName}</span>
                            <StatusBadge status={turn.status} />
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-[10px] text-[var(--vscode-fg-subtle)]">
                            {turn.duration && <span>⏱️ {turn.duration}s</span>}
                            {turn.metrics.tokens > 0 && <span>💎 {turn.metrics.tokens} Tok</span>}
                            {turn.metrics.diffs > 0 && <span>📝 {turn.metrics.diffs} {t('panels.timeline.diffs')}</span>}
                        </div>
                    </div>
                </div>
                <div className="text-[var(--vscode-fg-subtle)]">
                    {expanded ? '▲' : '▼'}
                </div>
            </div>

            {/* Expanded Body */}
            <AnimatePresence>
                {expanded && (
                    <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: 'auto' }}
                        exit={{ height: 0 }}
                        className="overflow-hidden border-t border-[var(--vscode-sidebar-border)] bg-[var(--vscode-bg)]"
                    >
                        <div className="p-3 space-y-3">
                            {turn.events.map(event => (
                                <DetailEventRow key={event.id} event={event} />
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

const StatusBadge = ({ status }) => {
    const { t } = useLocale();
    if (status === 'running') return <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded animate-pulse">● {t('panels.timeline.statusRunning')}</span>;
    if (status === 'completed') return <span className="text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded">{t('panels.timeline.statusCompleted')}</span>;
    if (status === 'failed') return <span className="text-[10px] text-red-600 bg-red-50 px-1.5 py-0.5 rounded">{t('panels.timeline.statusFailed')}</span>;
    return null;
};

const DetailEventRow = ({ event }) => {
    const { t } = useLocale();
    const EVENT_LABELS = {
        context_select: t('panels.timeline.eventContextSelect'),
        context_compress: t('panels.timeline.eventContextCompress'),
        context_health_check: t('panels.timeline.eventHealthCheck'),
        tool_call: t('panels.timeline.eventToolCall'),
        tool_result: t('panels.timeline.eventToolResult'),
        llm_request: t('panels.timeline.eventLlmRequest'),
        handoff: t('panels.timeline.eventHandoff'),
        diff_generated: t('panels.timeline.eventDiffGenerated'),
        agent_start: t('panels.timeline.eventAgentStart'),
        agent_end: t('panels.timeline.eventAgentEnd'),
        agent_error: t('panels.timeline.eventAgentError'),
    };
    // 详情中忽略 start/end（已在卡片体现）
    if (event.type === 'agent_start' || event.type === 'agent_end') return null;

    const label = EVENT_LABELS[event.type] || event.type;
    const icon = EVENT_ICONS[event.type] || '📌';
    const time = new Date(event.timestamp * 1000).toLocaleTimeString('zh-CN', { hour12: false });

    return (
        <div className="flex gap-3 text-xs group">
            <div className="w-12 text-[10px] text-[var(--vscode-fg-subtle)] font-mono pt-1 text-right shrink-0">{time}</div>
            <div className="w-6 flex flex-col items-center">
                <div className="w-6 h-6 rounded-[4px] bg-[var(--vscode-input-bg)] text-[var(--vscode-fg-subtle)] flex items-center justify-center text-sm border border-[var(--vscode-sidebar-border)] group-hover:border-[var(--vscode-focus-border)] group-hover:text-[var(--vscode-fg)] transition-colors">
                    {icon}
                </div>
                <div className="w-[1px] bg-[var(--vscode-sidebar-border)] flex-1 my-1 last:hidden" />
            </div>
            <div className="flex-1 pb-2">
                <div className="font-medium text-[var(--vscode-fg)] mb-0.5">{label}</div>
                <EventPayloadRenderer event={event} />
            </div>
        </div>
    );
};

const EventPayloadRenderer = ({ event }) => {
    const { t } = useLocale();
    const { type, data } = event;

    if (type === 'llm_request') {
        return (
            <div className="text-[10px] bg-[var(--vscode-input-bg)] p-2 rounded-[4px] border border-[var(--vscode-sidebar-border)] font-mono text-[var(--vscode-fg-subtle)]">
                <div>{t('panels.timeline.labelModel')}{data.model}</div>
                <div className="flex gap-2 mt-1">
                    <span className="text-blue-600">{t('panels.timeline.labelInput')}{data.tokens?.prompt}</span>
                    <span className="text-green-600">{t('panels.timeline.labelOutput')}{data.tokens?.completion}</span>
                    <span className="text-[var(--vscode-fg-subtle)]">{data.latency_ms}ms</span>
                </div>
            </div>
        );
    }

    if (type === 'context_select') {
        return (
            <div className="text-[10px]">
                <span className="text-[var(--vscode-fg-subtle)]">{t('panels.timeline.contextSelected')} </span>
                <span className="font-bold text-[var(--vscode-fg)]">{data.selected}</span>
                <span className="text-[var(--vscode-fg-subtle)]"> / {data.candidates} {t('panels.timeline.contextItems')}</span>
                <div className="h-1 bg-[var(--vscode-list-hover)] rounded-full mt-1 w-24 overflow-hidden">
                    <div className="h-full bg-[var(--vscode-focus-border)]" style={{ width: `${(data.selected / data.candidates) * 100}%` }} />
                </div>
            </div>
        );
    }

    if (type === 'diff_generated') {
        return (
            <div className="text-[10px] font-mono flex gap-3">
                <span className="text-green-600">+{data.additions}</span>
                <span className="text-red-600">-{data.deletions}</span>
            </div>
        );
    }

    // 其他类型默认展示 JSON
    return (
        <pre className="text-[10px] text-[var(--vscode-fg-subtle)] overflow-x-auto whitespace-pre-wrap font-mono bg-[var(--vscode-input-bg)] p-1.5 rounded-[4px] border border-[var(--vscode-sidebar-border)]">
            {JSON.stringify(data, (key, value) => {
                if (key === 'content' && typeof value === 'string' && value.length > 100) return value.substring(0, 100) + '...';
                return value;
            }, 2)}
        </pre>
    );
};

// --- 主组件 ---

const AgentTimeline = ({ events = [], autoScroll = true, maxHeight = '100%' }) => {
    const { t } = useLocale();
    const containerRef = useRef(null);
    const [expandedTurns, setExpandedTurns] = useState(new Set()); // Store IDs of expanded turns

    // 1. Group events
    const turns = useMemo(() => groupEventsByTurn(events), [events]);

    // 2. Auto-expand the LATEST running turn
    useEffect(() => {
        const lastTurn = turns[turns.length - 1];
        if (lastTurn && lastTurn.status === 'running' && !turns.slice(0, -1).some(t => t.id === lastTurn.id)) {
            setExpandedTurns(prev => new Set(prev).add(lastTurn.id));
        }
    }, [turns]);

    // 3. Auto-scroll
    useEffect(() => {
        if (autoScroll && containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [events.length, autoScroll]);

    const toggleTurn = (id) => {
        setExpandedTurns(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    return (
        <div ref={containerRef} className="h-full overflow-y-auto p-3 space-y-4 custom-scrollbar bg-[var(--vscode-bg)]" style={{ maxHeight }}>
            {turns.length === 0 ? (
                <div className="text-center py-10 text-[var(--vscode-fg-subtle)] text-xs">
                    <p>{t('panels.timeline.noActions')}</p>
                    <p className="opacity-50 mt-1">{t('panels.timeline.waitingStart')}</p>
                </div>
            ) : (
                turns.map((item) => {
                    if (item.type === 'separator') return <HandoffSeparator key={item.id} data={item.data} />;
                    return (
                        <TurnCard
                            key={item.id}
                            turn={item}
                            expanded={expandedTurns.has(item.id)}
                            onToggle={() => toggleTurn(item.id)}
                        />
                    );
                })
            )}
            <div className="h-4" /> {/* Bottom padding */}
        </div>
    );
};

export default AgentTimeline;
