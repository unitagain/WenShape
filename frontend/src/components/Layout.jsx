import React, { useState } from 'react';
import { BookOpen, Settings, ChevronLeft, ChevronRight, Menu, PenTool, Bot } from 'lucide-react';
import { Button, cn } from './ui/core';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';

export const Layout = ({ onOpenSettings }) => {
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const navigate = useNavigate();
    const location = useLocation();

    // Extract projectId from URL path: /project/:projectId/...
    const getProjectIdFromPath = () => {
        const match = location.pathname.match(/\/project\/([^/]+)/);
        return match ? match[1] : null;
    };

    const projectId = getProjectIdFromPath();

    return (
        <div className="flex h-screen w-full bg-background overflow-hidden font-sans text-ink-900">
            {/* Sidebar */}
            <aside
                className={cn(
                    "flex-shrink-0 h-full bg-surface/50 border-r border-border transition-all duration-300 ease-in-out relative z-20",
                    isSidebarOpen ? "w-64" : "w-16"
                )}
            >
                <div className="flex flex-col h-full p-3">
                    {/* Header / Logo */}
                    <div className={cn("flex items-center mb-8", isSidebarOpen ? "justify-between px-2" : "justify-center")}>
                        {isSidebarOpen && <span className="font-serif font-bold text-xl tracking-tight">NOVIX</span>}
                        <Button variant="ghost" size="icon" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
                            {isSidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
                        </Button>
                    </div>

                    {/* Navigation Items */}
                    <nav className="space-y-2 flex-1">
                        <NavItem
                            icon={<BookOpen className="h-4 w-4" />}
                            label="小说管理"
                            collapsed={!isSidebarOpen}
                            onClick={() => navigate('/')}
                        />
                        <NavItem
                            icon={<Bot className="h-4 w-4" />}
                            label="智能体配置"
                            collapsed={!isSidebarOpen}
                            onClick={() => navigate('/agents')}
                        />
                    </nav>
                </div>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 h-full overflow-hidden relative flex flex-col">
                <Outlet />
            </main>
        </div>
    );
};

const NavItem = ({ icon, label, collapsed, active, onClick }) => (
    <button
        onClick={onClick}
        className={cn(
            "flex items-center w-full p-2 rounded-md transition-colors group",
            active ? "bg-primary-light text-ink-900" : "text-ink-500 hover:bg-primary-light hover:text-ink-900",
            collapsed ? "justify-center" : "space-x-3"
        )}
    >
        {icon}
        {!collapsed && <span className="text-sm font-medium">{label}</span>}
    </button>
);
