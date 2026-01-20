import React from 'react';
import { useIDE } from '../../context/IDEContext';
import {
    Files,
    BookOpen,
    Search,
    Settings,
    Layers,
    Bot,
    BarChart2
} from 'lucide-react';
import { cn } from '../../components/ui/core';

export function ActivityBar() {
    const { state, dispatch } = useIDE();

    const icons = [
        { id: 'dashboard', icon: BarChart2, label: '仪表盘' },
        { id: 'explorer', icon: Files, label: '资源管理器' },
        { id: 'cards', icon: BookOpen, label: '设定卡片' },
        { id: 'search', icon: Search, label: '搜索' },
        { id: 'agents', icon: Bot, label: '智能体' },
    ];

    const bottomIcons = [
        { id: 'settings', icon: Settings, label: '设置' }
    ];

    return (
        <div className="w-12 flex flex-col items-center py-2 bg-surface/80 border-r border-border backdrop-blur-sm z-30">
            <div className="flex-1 space-y-4">
                {icons.map(item => (
                    <ActivityItem
                        key={item.id}
                        icon={item.icon}
                        label={item.label}
                        isActive={state.activeActivity === item.id && state.sidePanelVisible}
                        onClick={() => dispatch({ type: 'SET_ACTIVE_PANEL', payload: item.id })}
                    />
                ))}
            </div>

            <div className="space-y-4">
                {bottomIcons.map(item => (
                    <ActivityItem
                        key={item.id}
                        icon={item.icon}
                        label={item.label}
                        isActive={state.activeActivity === item.id && state.sidePanelVisible}
                        onClick={() => dispatch({ type: 'SET_ACTIVE_PANEL', payload: item.id })}
                    />
                ))}
            </div>
        </div>
    );
}

function ActivityItem({ icon: Icon, label, isActive, onClick }) {
    return (
        <button
            onClick={onClick}
            title={label}
            className={cn(
                "w-10 h-10 flex items-center justify-center rounded-md transition-all duration-200 group relative",
                isActive
                    ? "text-primary bg-primary/10"
                    : "text-ink-400 hover:text-ink-900 hover:bg-ink-100"
            )}
        >
            <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
            {isActive && (
                <div className="absolute left-0 top-2 bottom-2 w-[3px] bg-primary rounded-r-full" />
            )}
        </button>
    );
}
