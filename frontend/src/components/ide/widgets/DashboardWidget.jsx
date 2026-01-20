import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { projectsAPI } from '../../../api';
import {
    Activity, Users, BookOpen, RefreshCw, BarChart2,
    AlertCircle, CheckCircle2, Clock
} from 'lucide-react';
import { cn } from '../../ui/core';

export default function DashboardWidget() {
    const { projectId } = useParams();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const loadStats = async () => {
        if (!projectId) return;
        setLoading(true);
        setError(null);
        try {
            const res = await projectsAPI.getDashboard(projectId);
            setData(res.data);
        } catch (error) {
            console.error("Failed to load dashboard stats", error);
            setError(error.message || "加载失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadStats();
    }, [projectId]);

    if (loading && !data) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-ink-400 gap-2">
                <RefreshCw size={16} className="animate-spin" />
                <span className="text-xs">加载数据中...</span>
            </div>
        );
    }

    if (!data) return null;

    const stats = data.stats || {};
    const chapters = data.chapters || [];
    const recentFacts = data.recent?.facts || [];

    return (
        <div className="h-full overflow-y-auto custom-scrollbar p-3 space-y-4">
            {/* Header / Refresh */}
            <div className="flex items-center justify-between pb-2 border-b border-border/50">
                <div className="flex items-center gap-2 text-ink-900 font-bold">
                    <BarChart2 size={16} className="text-primary" />
                    <span>项目概览</span>
                </div>
                <button
                    onClick={loadStats}
                    className="p-1.5 hover:bg-ink-100 rounded-md text-ink-400 hover:text-ink-900 transition-colors"
                    title="刷新数据"
                >
                    <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                </button>
            </div>

            {/* Core Stats Grid (Removed Completion Rate as requested) */}
            <div className="grid grid-cols-2 gap-2">
                <StatTile
                    icon={<BookOpen size={14} />}
                    label="总字数"
                    value={(stats.total_word_count || 0).toLocaleString()}
                    color="text-primary"
                />
                <StatTile
                    icon={<Users size={14} />}
                    label="角色数"
                    value={stats.character_count || 0}
                    color="text-blue-500"
                />
                <StatTile
                    icon={<Activity size={14} />}
                    label="实体总数"
                    value={(stats.fact_count || 0) + (stats.timeline_event_count || 0)}
                    color="text-yellow-600"
                />
            </div>

            {/* Chapters List (Compact) */}
            <div className="space-y-2">
                <SectionHeader icon={<BookOpen size={14} />} title="章节状态" count={chapters.length} />
                <div className="space-y-1.5">
                    {chapters.length === 0 ? (
                        <EmptyState text="暂无章节" />
                    ) : (
                        chapters.map(ch => (
                            <div key={ch.chapter} className="flex items-center justify-between p-2 bg-surface border border-border rounded hover:border-primary/30 transition-colors group">
                                <div className="flex-1 min-w-0 pr-2">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-xs text-ink-900 truncate">
                                            {ch.chapter}
                                        </span>
                                        {ch.has_summary && (
                                            <span className="px-1 py-0.5 rounded-[2px] bg-blue-50 text-blue-600 text-[9px] font-mono leading-none">
                                                SUM
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-[10px] text-ink-400 mt-0.5 truncate font-mono">
                                        {ch.has_final ? `${ch.final_word_count} 字` : '无内容'}
                                    </div>
                                </div>
                                <div className="shrink-0">
                                    {(ch.conflict_count || 0) > 0 ? (
                                        <span className="flex items-center gap-1 text-[10px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded border border-red-100 font-bold">
                                            {ch.conflict_count} ERR
                                        </span>
                                    ) : (
                                        <span className="text-green-500 text-[10px]">
                                            <CheckCircle2 size={14} />
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Recent Facts (Compact) */}
            <div className="space-y-2">
                <SectionHeader icon={<Activity size={14} />} title="近期事实" count={recentFacts.length} />
                <div className="space-y-1.5">
                    {recentFacts.length === 0 ? (
                        <EmptyState text="暂无近期变动" />
                    ) : (
                        recentFacts.slice(0, 5).map((f, idx) => (
                            <div key={idx} className="p-2 bg-surface border-l-2 border-l-primary/50 border-y border-r border-border rounded-r text-xs">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="font-mono font-bold text-[10px] text-primary bg-primary/5 px-1 rounded">
                                        {f.id}
                                    </span>
                                </div>
                                <div className="text-ink-700 line-clamp-2 leading-relaxed">
                                    {f.statement}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

function StatTile({ icon, label, value, color }) {
    return (
        <div className="bg-surface p-2 rounded border border-border flex flex-col items-center justify-center gap-1 hover:shadow-sm transition-shadow">
            <div className={cn("opacity-80", color)}>{icon}</div>
            <div className="text-[10px] text-ink-400 uppercase tracking-tighter scale-90">{label}</div>
            <div className="text-sm font-bold font-serif text-ink-900">{value}</div>
        </div>
    );
}

function SectionHeader({ icon, title, count }) {
    return (
        <div className="flex items-center gap-2 text-xs font-bold text-ink-500 px-1 mt-4">
            {icon}
            <span>{title}</span>
            <span className="ml-auto bg-ink-100 text-ink-600 text-[10px] px-1.5 rounded-full min-w-[1.2rem] text-center">
                {count}
            </span>
        </div>
    );
}

function EmptyState({ text }) {
    return (
        <div className="p-4 text-center border border-dashed border-border rounded">
            <span className="text-xs text-ink-400 italic">{text}</span>
        </div>
    );
}
