import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useIDE } from '../../context/IDEContext';
import { Bot, X } from 'lucide-react';
import { cn } from '../ui/core';

export function TitleBar({ projectName, chapterTitle }) {
    const navigate = useNavigate();
    const { state, dispatch } = useIDE();

    return (
        <div className="h-10 min-h-[40px] bg-surface border-b border-border flex items-center justify-between px-4 select-none flex-shrink-0">
            {/* 左侧: Logo - 与首页一致 */}
            <button
                onClick={() => navigate('/')}
                className="font-serif font-bold text-xl tracking-tight text-ink-900 hover:text-primary transition-colors"
            >
                NOVIX
            </button>

            {/* 中央: 标题 */}
            <div className="flex-1 flex items-center justify-center gap-2 text-sm">
                {state.unsavedChanges && (
                    <span className="text-yellow-500 text-lg">●</span>
                )}
                <span className="text-ink-500">{projectName || '未选择项目'}</span>
                {chapterTitle && (
                    <>
                        <span className="text-ink-300">/</span>
                        <span className="text-ink-900 font-medium">{chapterTitle}</span>
                    </>
                )}
            </div>

            {/* 右侧: AI 助手切换 */}
            <button
                onClick={() => dispatch({ type: 'TOGGLE_RIGHT_PANEL' })}
                className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors",
                    state.rightPanelVisible
                        ? "bg-primary text-white"
                        : "text-ink-600 hover:bg-ink-50 hover:text-ink-900"
                )}
                title={state.rightPanelVisible ? "关闭 AI 助手" : "打开 AI 助手"}
            >
                {state.rightPanelVisible ? (
                    <>
                        <Bot size={14} />
                        <span>AI 助手</span>
                        <X size={12} />
                    </>
                ) : (
                    <>
                        <Bot size={14} />
                        <span>AI 助手</span>
                    </>
                )}
            </button>
        </div>
    );
}
