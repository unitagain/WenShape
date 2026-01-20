import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useIDE } from '../../../context/IDEContext';
import { useParams } from 'react-router-dom';
import { draftsAPI } from '../../../api';
import { FileText, Plus, FolderOpen, RefreshCw } from 'lucide-react';
import { cn } from '../../ui/core';



export default function ExplorerPanel() {
    const { projectId } = useParams();
    // ... hooks ...

    // hooks are same
    const { state, dispatch } = useIDE();
    const [chapters, setChapters] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        loadChapters();
    }, [projectId]);

    const loadChapters = async () => {
        setLoading(true);
        try {
            const resp = await draftsAPI.listChapters(projectId);
            const list = Array.isArray(resp.data) ? resp.data : [];
            setChapters(list.sort());
        } catch (e) {
            console.error("Failed to load chapters", e);
        } finally {
            setLoading(false);
        }
    };

    const handleChapterClick = (chapterId) => {
        dispatch({ type: 'SET_ACTIVE_DOCUMENT', payload: { type: 'chapter', id: chapterId } });
    };

    return (
        <div className="h-full flex flex-col">

            <div className="p-2 flex items-center justify-between opacity-50 hover:opacity-100 transition-opacity mt-2">
                <span className="text-xs font-bold uppercase tracking-wider pl-2">目录</span>
                <div className="flex gap-1">
                    <button onClick={loadChapters} className="p-1 hover:bg-black/5 rounded" title="刷新">
                        <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
                    </button>
                    <button
                        onClick={() => dispatch({ type: 'OPEN_CREATE_CHAPTER_DIALOG' })}
                        className="p-1 hover:bg-black/5 rounded"
                        title="新建章节"
                    >
                        <Plus size={12} />
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-2">
                {chapters.length === 0 && !loading && (
                    <div className="text-center text-xs text-ink-400 py-8">
                        暂无章节
                    </div>
                )}

                <div className="space-y-0.5">
                    <div className="space-y-0.5">
                        <AnimatePresence>
                            {chapters.map((chapter, idx) => (
                                <motion.div
                                    key={chapter}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -10 }}
                                    transition={{ duration: 0.2, delay: idx * 0.03 }}
                                    onClick={() => handleChapterClick(chapter)}
                                    className={cn(
                                        "flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm transition-colors group",
                                        state.activeDocument?.id === chapter
                                            ? "bg-primary/10 text-primary font-medium"
                                            : "text-ink-700 hover:bg-ink-50"
                                    )}
                                >
                                    <FileText size={14} className={cn(
                                        "shrink-0",
                                        state.activeDocument?.id === chapter ? "text-primary" : "text-ink-400 group-hover:text-ink-600"
                                    )} />
                                    <span className="truncate">{chapter}</span>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                </div>
            </div>

            <div className="p-2 border-t border-border mt-auto opacity-50 text-[10px] text-center">
                Project: {projectId}
            </div>
        </div>
    );
}
