import React, { useEffect } from 'react';
import { useIDE } from '../../context/IDEContext';
import { ActivityBar } from './ActivityBar';
import { SidePanel } from './SidePanel';
import { StatusBar } from './StatusBar';
import { TitleBar } from './TitleBar';

export function IDELayout({ children, rightPanelContent, titleBarProps = {} }) {
    const { state, dispatch } = useIDE();

    // Keyboard Shortcuts
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
                e.preventDefault();
                dispatch({ type: 'TOGGLE_LEFT_PANEL' });
            }
            if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
                e.preventDefault();
                dispatch({ type: 'TOGGLE_ZEN_MODE' });
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [dispatch]);

    return (
        <div className="h-screen w-full flex flex-col bg-background overflow-hidden">
            {/* 顶部栏 */}
            {!state.zenMode && <TitleBar {...titleBarProps} />}

            {/* 主体区域 */}
            <div className="flex-1 flex overflow-hidden min-h-0">
                {/* Activity Bar (固定左侧) */}
                {!state.zenMode && <ActivityBar />}

                {/* Left Panel (可调整大小/可折叠) */}
                {!state.zenMode && state.sidePanelVisible && <SidePanel />}

                {/* 编辑器区域 */}
                <main className="flex-1 overflow-y-auto bg-background min-w-0">
                    {children}
                </main>

                {/* Right Panel (AI 侧边栏) */}
                {!state.zenMode && state.rightPanelVisible && (
                    <div
                        className="border-l border-border flex-shrink-0 bg-surface overflow-hidden flex flex-col"
                        style={{ width: state.rightPanelWidth }}
                    >
                        {rightPanelContent}
                    </div>
                )}
            </div>

            {/* 底部状态栏 */}
            <StatusBar />
        </div>
    );
}
