import React from 'react';
import { cn, Card, Button } from '../ui/core';
import { X, MessageSquare, Terminal } from 'lucide-react';

export const WritingSidebar = ({ isOpen, onClose, title, children, icon: Icon = Terminal }) => {
    return (
        <div
            className={cn(
                "flex flex-col h-full bg-surface border-l border-border shadow-sm transform transition-transform duration-300 ease-in-out font-sans",
                // isOpen ? "translate-x-0" : "translate-x-full" // Handled by Layout
            )}
        >
            <div className="flex flex-col h-full">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border">
                    <div className="flex items-center gap-2 font-medium text-ink-900">
                        <Icon size={16} className="text-primary" />
                        <span>{title}</span>
                    </div>
                    <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 text-ink-500 hover:text-ink-900">
                        <X size={16} />
                    </Button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                    {children}
                </div>
            </div>
        </div>
    );
};
