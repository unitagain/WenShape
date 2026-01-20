import React from 'react';
import { useIDE } from '../../context/IDEContext';
import {
    GitBranch, Folder, PenTool, Save, AlertCircle,
    FileText, Radio, Bell, Bot
} from 'lucide-react';
import { cn } from '../ui/core';

export function StatusBar() {
    const { state } = useIDE();
    const {
        activeProjectId,
        wordCount,
        cursorPosition,
        lastSavedAt,
        unsavedChanges,
        connectionStatus,
        zenMode
    } = state;

    const formatTime = (date) => {
        if (!date) return '--:--';
        return new Date(date).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const getConnectionColor = () => {
        switch (connectionStatus) {
            case 'connected': return 'bg-green-500';
            case 'syncing': return 'bg-yellow-500 animate-pulse';
            case 'disconnected': return 'bg-red-500';
            default: return 'bg-gray-400';
        }
    };

    const getConnectionText = () => {
        switch (connectionStatus) {
            case 'connected': return '已连接';
            case 'syncing': return '同步中...';
            case 'disconnected': return '已断开';
            default: return '未知';
        }
    };

    if (zenMode) return null; // 禅模式下隐藏状态栏

    return (
        <div className="h-6 min-h-[24px] bg-primary text-white flex items-center justify-between px-2 text-[11px] select-none flex-shrink-0 z-50">
            {/* 左侧信息 */}
            <div className="flex items-center gap-1">
                {/* 版本控制 */}
                <button className="flex items-center gap-1.5 px-2 h-full hover:bg-white/10 rounded transition-colors">
                    <GitBranch size={12} />
                    <span>main</span>
                </button>

                {/* 项目名称 */}
                {activeProjectId && (
                    <button className="flex items-center gap-1.5 px-2 h-full hover:bg-white/10 rounded transition-colors">
                        <Folder size={12} />
                        <span className="max-w-[120px] truncate">{activeProjectId}</span>
                    </button>
                )}

                {/* 编辑状态 */}
                <button className="flex items-center gap-1.5 px-2 h-full hover:bg-white/10 rounded transition-colors">
                    <PenTool size={12} />
                    <span>编辑中</span>
                </button>

                {/* 保存状态 */}
                <button className="flex items-center gap-1.5 px-2 h-full hover:bg-white/10 rounded transition-colors">
                    {unsavedChanges ? (
                        <>
                            <AlertCircle size={12} className="text-yellow-300" />
                            <span>未保存</span>
                        </>
                    ) : lastSavedAt ? (
                        <>
                            <Save size={12} className="text-green-300" />
                            <span>已保存 {formatTime(lastSavedAt)}</span>
                        </>
                    ) : (
                        <>
                            <Save size={12} className="opacity-50" />
                            <span className="opacity-50">--:--</span>
                        </>
                    )}
                </button>
            </div>

            {/* 右侧状态 */}
            <div className="flex items-center gap-1">
                {/* 字数统计 */}
                <button className="flex items-center gap-1.5 px-2 h-full hover:bg-white/10 rounded transition-colors">
                    <FileText size={12} />
                    <span>{wordCount.toLocaleString()} 字</span>
                </button>

                {/* 光标位置 */}
                <button className="flex items-center gap-1.5 px-2 h-full hover:bg-white/10 rounded transition-colors font-mono">
                    <span>Ln {cursorPosition.line}, Col {cursorPosition.column}</span>
                </button>

                {/* AI 状态 */}
                <button className="flex items-center gap-1.5 px-2 h-full hover:bg-white/10 rounded transition-colors">
                    <Bot size={12} />
                    <span>AI</span>
                </button>

                {/* 连接状态 */}
                <button className="flex items-center gap-1.5 px-2 h-full hover:bg-white/10 rounded transition-colors">
                    <div className={cn("w-2 h-2 rounded-full", getConnectionColor())} />
                    <span>{getConnectionText()}</span>
                </button>

                {/* 通知 */}
                <button className="flex items-center gap-1.5 px-2 h-full hover:bg-white/10 rounded transition-colors">
                    <Bell size={12} />
                </button>
            </div>
        </div>
    );
}
