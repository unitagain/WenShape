/**
 * 文枢 WenShape - 深度上下文感知的智能体小说创作系统
 * WenShape - Deep Context-Aware Agent-Based Novel Writing System
 *
 * Copyright © 2025-2026 WenShape Team
 * License: PolyForm Noncommercial License 1.0.0
 */

import React from 'react';
import { cn, Button } from '../ui/core';
import { X, Terminal } from 'lucide-react';

/**
 * 写作侧栏组件 - 可折叠的侧栏容器，负责内容承载与关闭入口
 *
 * A flexible sidebar component for displaying contextual information during writing sessions.
 * Supports custom icons and handles header/content layout. Typically used for feedback,
 * analysis results, or contextual information panels.
 *
 * @component
 * @example
 * return (
 *   <WritingSidebar
 *     isOpen={true}
 *     title="生成反馈"
 *     icon={MessageSquare}
 *     onClose={handleClose}
 *   >
 *     <p>Sidebar content here...</p>
 *   </WritingSidebar>
 * )
 *
 * @param {Object} props - Component props
 * @param {boolean} [props.isOpen=false] - 侧栏是否打开 / Whether sidebar is visible
 * @param {Function} [props.onClose] - 关闭回调 / Callback when close button is clicked
 * @param {string} [props.title] - 侧栏标题 / Sidebar header title
 * @param {React.ReactNode} [props.children] - 侧栏内容 / Sidebar content
 * @param {React.ComponentType} [props.icon=Terminal] - 标题图标组件 / Icon component for title
 * @returns {JSX.Element} 写作侧栏元素 / Writing sidebar element
 */
export const WritingSidebar = ({ isOpen: _isOpen, onClose, title, children, icon: Icon = Terminal }) => {
    return (
        <div
            className={cn(
                "flex flex-col h-full bg-[var(--vscode-sidebar-bg)] border-l border-[var(--vscode-sidebar-border)] transform transition-transform duration-300 ease-in-out font-sans z-20",
                // isOpen 状态由父组件的 Layout 管理
                // isOpen state is handled by parent Layout component
            )}
        >
            <div className="flex flex-col h-full">
                {/*
                  ======================================================================
                  侧栏头部 / Sidebar header
                  ======================================================================
                  包含标题、图标和关闭按钮
                  Contains title, icon, and close button
                */}
                <div className="flex items-center justify-between p-4 border-b border-[var(--vscode-sidebar-border)] bg-[var(--vscode-sidebar-bg)]">
                    <div className="flex items-center gap-2 font-medium text-[var(--vscode-fg)]">
                        <Icon size={16} className="text-[var(--vscode-fg-subtle)]" />
                        <span>{title}</span>
                    </div>
                    <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 text-[var(--vscode-fg-subtle)] hover:text-[var(--vscode-fg)]">
                        <X size={16} />
                    </Button>
                </div>

                {/*
                  ======================================================================
                  侧栏内容区域 / Sidebar content area
                  ======================================================================
                  可滚动的内容容器，支持任意子组件
                  Scrollable content container with flexible child components
                */}
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                    {children}
                </div>
            </div>
        </div>
    );
};
