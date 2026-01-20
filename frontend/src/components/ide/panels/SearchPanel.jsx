import React, { useState } from 'react';
import { useIDE } from '../../../context/IDEContext';
import { Search, Loader2 } from 'lucide-react';
import { Input, Button } from '../../ui/core';

export default function SearchPanel() {
    const [query, setQuery] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const { dispatch } = useIDE();

    const handleSearch = (e) => {
        e.preventDefault();
        if (!query.trim()) return;

        // TODO: Implement actual search API integration
        setIsSearching(true);
        setTimeout(() => {
            setIsSearching(false);
        }, 1000);
    };

    return (
        <div className="h-full flex flex-col">
            <div className="p-3 border-b border-border/50">
                <form onSubmit={handleSearch} className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground opacity-50" />
                    <Input
                        placeholder="全局搜索..."
                        className="pl-8 h-9 text-xs bg-background/50"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                </form>
            </div>

            <div className="flex-1 overflow-y-auto p-4 text-center">
                {isSearching ? (
                    <div className="flex flex-col items-center justify-center text-ink-400 py-8 gap-2">
                        <Loader2 size={16} className="animate-spin" />
                        <span className="text-xs">Searching...</span>
                    </div>
                ) : (
                    <div className="text-xs text-ink-400">
                        在这里搜索项目内容、角色和设定。
                        <br /><br />
                        (Search API integration pending)
                    </div>
                )}
            </div>
        </div>
    );
}
