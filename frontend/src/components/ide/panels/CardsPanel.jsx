import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useIDE } from '../../../context/IDEContext';
import { useParams } from 'react-router-dom';
import { cardsAPI } from '../../../api';
import { Users, Map, Plus, RefreshCw, User, Globe } from 'lucide-react';
import { cn } from '../../ui/core';

export default function CardsPanel() {
    const { projectId } = useParams();
    const { state, dispatch } = useIDE();
    const [entities, setEntities] = useState([]);
    const [loading, setLoading] = useState(false);
    const [typeFilter, setTypeFilter] = useState('all'); // 'all', 'character', 'world'

    useEffect(() => {
        loadEntities();
    }, [projectId]);

    const loadEntities = async () => {
        setLoading(true);
        try {
            // Parallel fetch characters and world entities
            const [charsResp, worldsResp] = await Promise.allSettled([
                cardsAPI.listCharacters(projectId),
                cardsAPI.listWorld(projectId)  // 修复: listWorlds -> listWorld
            ]);

            const chars = charsResp.status === 'fulfilled' ? (Array.isArray(charsResp.value.data) ? charsResp.value.data : []) : [];
            const worlds = worldsResp.status === 'fulfilled' ? (Array.isArray(worldsResp.value.data) ? worldsResp.value.data : []) : [];

            // Add type tag
            // API returns list of strings (names), so we map them to objects
            const combined = [
                ...chars.map(name => ({ name, type: 'character' })),
                ...worlds.map(name => ({ name, type: 'world' }))
            ];

            setEntities(combined);
        } catch (e) {
            console.error("Failed to load cards", e);
        } finally {
            setLoading(false);
        }
    };

    const filteredEntities = entities.filter(e => typeFilter === 'all' || e.type === typeFilter);

    return (
        <div className="h-full flex flex-col">
            <div className="p-2 border-b border-border/50">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider pl-2 text-ink-500">卡片库</span>
                    <div className="flex gap-1">
                        <button onClick={loadEntities} className="p-1 hover:bg-black/5 rounded" title="刷新">
                            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
                        </button>
                        <button className="p-1 hover:bg-black/5 rounded" title="新建">
                            <Plus size={12} />
                        </button>
                    </div>
                </div>
                {/* Type Filter */}
                <div className="flex gap-1 px-1">
                    <button
                        onClick={() => setTypeFilter('all')}
                        className={cn("text-[10px] px-2 py-0.5 rounded border transition-colors", typeFilter === 'all' ? "bg-primary/10 border-primary/20 text-primary" : "border-transparent hover:bg-ink-50 text-ink-500")}
                    >全部</button>
                    <button
                        onClick={() => setTypeFilter('character')}
                        className={cn("text-[10px] px-2 py-0.5 rounded border transition-colors", typeFilter === 'character' ? "bg-primary/10 border-primary/20 text-primary" : "border-transparent hover:bg-ink-50 text-ink-500")}
                    >角色</button>
                    <button
                        onClick={() => setTypeFilter('world')}
                        className={cn("text-[10px] px-2 py-0.5 rounded border transition-colors", typeFilter === 'world' ? "bg-primary/10 border-primary/20 text-primary" : "border-transparent hover:bg-ink-50 text-ink-500")}
                    >设定</button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-2">
                {entities.length === 0 && !loading && (
                    <div className="text-center text-xs text-ink-400 py-8">
                        暂无卡片数据
                    </div>
                )}

                <div className="space-y-1">
                    <AnimatePresence>
                        {filteredEntities.map((entity, idx) => (
                            <motion.div
                                key={entity.id || idx}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                transition={{ duration: 0.2, delay: idx * 0.05 }}
                                onClick={() => dispatch({
                                    type: 'SET_ACTIVE_DOCUMENT',
                                    payload: { type: entity.type || 'card', id: entity.name, data: entity }
                                })}
                                className={cn(
                                    "flex items-start gap-2 px-2 py-2 rounded cursor-pointer hover:bg-ink-50 group border border-transparent hover:border-border/50 transition-all",
                                    state.activeDocument?.id === entity.name && state.activeDocument?.type === (entity.type || 'card')
                                        ? "bg-primary/10 border-primary/20"
                                        : ""
                                )}
                            >
                                <div className="mt-0.5 opacity-60">
                                    {entity.type === 'character' ? <User size={14} className="text-indigo-500" /> : <Globe size={14} className="text-emerald-500" />}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm font-medium text-ink-700 leading-none mb-1">{entity.name}</div>
                                    {entity.identity && (
                                        <div className="text-[10px] text-ink-400 line-clamp-2 leading-tight">
                                            {entity.identity}
                                        </div>
                                    )}
                                    {entity.description && (
                                        <div className="text-[10px] text-ink-400 line-clamp-2 leading-tight">
                                            {entity.description}
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );
}
