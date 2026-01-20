import React, { useEffect, useState } from 'react';
import { useIDE } from '../../context/IDEContext';
import { cn } from '../ui/core';
import ExplorerPanel from './panels/ExplorerPanel';
import CardsPanel from './panels/CardsPanel';
import SearchPanel from './panels/SearchPanel';
import AgentsPanel from './panels/AgentsPanel';
import DashboardWidget from './widgets/DashboardWidget';

export const SidePanel = () => {
    const { state, dispatch } = useIDE();
    const { sidePanelVisible, activeActivity, sidePanelWidth } = state;

    if (!sidePanelVisible) return null;

    return (
        <div
            className="h-full border-r border-border bg-surface flex flex-col relative group"
            style={{ width: sidePanelWidth, minWidth: 160, maxWidth: 600 }}
        >
            {/* Header */}
            <div className="h-9 px-4 flex items-center justify-between border-b border-border/50 bg-surface text-xs font-bold uppercase tracking-wider text-ink-500 select-none flex-shrink-0">
                <span>{activeActivity.toUpperCase()}</span>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden h-full flex flex-col">

                {/* Main Panels */}
                <div className="flex-1 overflow-hidden min-h-0 relative">
                    {activeActivity === 'dashboard' && <div className="p-2"><DashboardWidget /></div>}
                    {activeActivity === 'explorer' && <ExplorerPanel />}
                    {activeActivity === 'search' && <SearchPanel />}
                    {activeActivity === 'cards' && <CardsPanel />}
                    {activeActivity === 'agents' && <AgentsPanel />}
                </div>
            </div>

            {/* Resize Handle */}
            <div
                className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/50 transition-colors z-50"
                onMouseDown={(e) => {
                    e.preventDefault();
                    const startX = e.pageX;
                    const startWidth = sidePanelWidth;

                    const handleMouseMove = (moveEvent) => {
                        const newWidth = Math.max(160, Math.min(600, startWidth + (moveEvent.pageX - startX)));
                        dispatch({ type: 'SET_PANEL_WIDTH', payload: newWidth });
                    };

                    const handleMouseUp = () => {
                        document.removeEventListener('mousemove', handleMouseMove);
                        document.removeEventListener('mouseup', handleMouseUp);
                    };

                    document.addEventListener('mousemove', handleMouseMove);
                    document.addEventListener('mouseup', handleMouseUp);
                }}
            />
        </div>
    );
};
