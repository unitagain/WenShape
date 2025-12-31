import React, { useState, useEffect } from 'react';
import { Button, Card, Input } from '../ui/core';
import { X, BookOpen, Sparkles, Drama } from 'lucide-react';

/**
 * 章节创建对话框
 * 
 * 支持创建:
 * - 正文章节 (C1, C2, ...)
 * - 番外篇 (C3E1, C3E2, ...)
 * - 幕间/过场 (C2I1, C2I2, ...)
 */
export function ChapterCreateDialog({ open, onClose, onConfirm, existingChapters = [] }) {
    const [chapterType, setChapterType] = useState('normal');
    const [insertAfter, setInsertAfter] = useState('');
    const [suggestedId, setSuggestedId] = useState('');
    const [customId, setCustomId] = useState('');
    const [title, setTitle] = useState('');

    // 自动计算建议ID
    useEffect(() => {
        if (!open) return;

        let suggested = '';

        if (chapterType === 'normal') {
            // 找到最大的章节号
            const normalChapters = existingChapters.filter(c => {
                const match = c.id.match(/^(?:V\d+)?C(\d+)$/);
                return match !== null;
            });

            let maxChapter = 0;
            normalChapters.forEach(c => {
                const match = c.id.match(/C(\d+)/);
                if (match) {
                    const num = parseInt(match[1]);
                    maxChapter = Math.max(maxChapter, num);
                }
            });

            suggested = `C${maxChapter + 1}`;

        } else if (chapterType === 'extra' && insertAfter) {
            // 统计该章节后已有多少个番外
            const extraCount = existingChapters.filter(c =>
                c.id.startsWith(insertAfter) && c.id.includes('E')
            ).length;
            suggested = `${insertAfter}E${extraCount + 1}`;

        } else if (chapterType === 'interlude' && insertAfter) {
            // 统计该章节后已有多少个幕间
            const interludeCount = existingChapters.filter(c =>
                c.id.startsWith(insertAfter) && c.id.includes('I')
            ).length;
            suggested = `${insertAfter}I${interludeCount + 1}`;
        }

        setSuggestedId(suggested);
        setCustomId('');
    }, [chapterType, insertAfter, existingChapters, open]);

    // 重置状态
    useEffect(() => {
        if (open) {
            setChapterType('normal');
            setInsertAfter('');
            setTitle('');
            setCustomId('');
        }
    }, [open]);

    if (!open) return null;

    const finalId = customId || suggestedId;
    const canCreate = title && finalId;

    // 获取正文章节列表（用于插入位置选择）
    const normalChapters = existingChapters.filter(c => {
        // 只显示正文章节作为插入点
        return /^(?:V\d+)?C\d+$/.test(c.id);
    });

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
            <Card className="w-full max-w-md bg-surface shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-border bg-gray-50/50">
                    <h3 className="text-lg font-bold text-ink-900">创建新章节</h3>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X size={18} />
                    </Button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-6">
                    {/* 章节类型 */}
                    <div className="space-y-3">
                        <label className="text-xs font-bold text-ink-500 uppercase tracking-wider">章节类型</label>
                        <div className="grid grid-cols-3 gap-3">
                            {[
                                { id: 'normal', icon: BookOpen, label: '正文', color: 'text-ink-600' },
                                { id: 'extra', icon: Sparkles, label: '番外', color: 'text-amber-500' },
                                { id: 'interlude', icon: Drama, label: '幕间', color: 'text-blue-500' }
                            ].map(({ id, icon: Icon, label, color }) => (
                                <label
                                    key={id}
                                    className={`flex flex-col items-center justify-center p-3 border rounded-lg cursor-pointer transition-all ${chapterType === id
                                            ? 'border-primary bg-primary/5 shadow-sm'
                                            : 'border-border hover:border-primary/30 hover:bg-surface-hover'
                                        }`}
                                >
                                    <input
                                        type="radio"
                                        name="type"
                                        value={id}
                                        checked={chapterType === id}
                                        onChange={(e) => setChapterType(e.target.value)}
                                        className="sr-only"
                                    />
                                    <Icon size={20} className={`mb-2 ${color}`} />
                                    <span className={`text-xs font-medium ${chapterType === id ? 'text-primary' : 'text-ink-600'}`}>
                                        {label}
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* 插入位置（仅非正文） */}
                    {chapterType !== 'normal' && (
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-ink-500 uppercase">插入位置</label>
                            <select
                                value={insertAfter}
                                onChange={(e) => setInsertAfter(e.target.value)}
                                className="w-full px-3 py-2 border border-border rounded bg-white text-ink-900 text-sm focus:outline-none focus:border-primary transition-colors cursor-pointer"
                            >
                                <option value="">请选择章节...</option>
                                {normalChapters.map(ch => (
                                    <option key={ch.id} value={ch.id}>
                                        在 {ch.id} 之后 - {ch.title || '未命名'}
                                    </option>
                                ))}
                            </select>
                            {!insertAfter && normalChapters.length > 0 && (
                                <p className="text-xs text-ink-400">选择要在哪个章节后插入</p>
                            )}
                        </div>
                    )}

                    {/* 章节ID */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-ink-500 uppercase">章节 ID</label>
                        <div className="space-y-1">
                            <Input
                                value={customId || suggestedId}
                                onChange={(e) => setCustomId(e.target.value.toUpperCase())}
                                placeholder="使用建议ID或手动输入"
                                className="font-mono"
                            />
                            {suggestedId && (
                                <p className="text-xs text-ink-400">
                                    💡 系统建议: <span className="font-mono font-medium text-primary">{suggestedId}</span>
                                </p>
                            )}
                        </div>
                    </div>

                    {/* 章节标题 */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-ink-500 uppercase">章节标题</label>
                        <Input
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="例如：第一章 初入京城"
                            className="font-serif"
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="flex gap-3 p-6 border-t border-border bg-gray-50">
                    <Button variant="ghost" onClick={onClose} className="flex-1">
                        取消
                    </Button>
                    <Button
                        onClick={() => {
                            if (canCreate) {
                                onConfirm({
                                    id: finalId,
                                    title,
                                    type: chapterType
                                });
                                onClose();
                            }
                        }}
                        className="flex-1"
                        disabled={!canCreate}
                    >
                        创建章节
                    </Button>
                </div>
            </Card>
        </div>
    );
}
