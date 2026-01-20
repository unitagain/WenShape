import React, { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { Bot, Book, Search, Edit3, Settings, MoreHorizontal, Circle, Plus } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { configAPI } from '../../../api';
import { cn } from '../../ui/core';
import LLMProfileModal from '../../../components/LLMProfileModal';

// Fetcher for SWR
const fetcher = (fn) => fn().then(res => res.data);

const ROLES = [
    { id: 'archivist', label: '资料管理员', eng: 'Archivist', icon: Book, desc: '管理设定' },
    { id: 'writer', label: '撰稿人', eng: 'Writer', icon: Edit3, desc: '负责撰写' },
    { id: 'reviewer', label: '审稿人', eng: 'Reviewer', icon: Search, desc: '评估质量' },
    { id: 'editor', label: '编辑', eng: 'Editor', icon: Bot, desc: '润色文笔' },
];

const AgentsPanel = () => {
    // Data Fetching
    const { data: profiles = [], isLoading: loadingProfiles } = useSWR(
        'llm-profiles',
        () => fetcher(configAPI.getProfiles),
        { revalidateOnFocus: false }
    );

    const { data: assignments = {}, isLoading: loadingAssignments } = useSWR(
        'agent-assignments',
        () => fetcher(configAPI.getAssignments),
        { revalidateOnFocus: false }
    );

    const isLoading = loadingProfiles || loadingAssignments;
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Handlers
    const handleAssignmentChange = async (roleId, profileId) => {
        const newAssignments = { ...assignments, [roleId]: profileId };

        // Optimistic UI update (optional, but SWR mutate is safer)
        mutate('agent-assignments', newAssignments, false);

        try {
            await configAPI.updateAssignments(newAssignments);
            mutate('agent-assignments'); // Re-verify with server
        } catch (e) {
            console.error("Failed to update assignment", e);
            mutate('agent-assignments'); // Rollback on error
        }
    };

    const handleSaveProfile = async (profileData) => {
        try {
            await configAPI.saveProfile(profileData);
            setIsModalOpen(false);
            mutate('llm-profiles');
        } catch (e) {
            console.error("Failed to save profile", e);
        }
    };

    return (
        <div className="flex flex-col h-full bg-surface text-ink-900">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <h2 className="text-sm font-bold flex items-center gap-2">
                    <Bot size={16} className="text-primary" />
                    <span>智能体协作</span>
                </h2>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => window.open('/agents', '_blank')}
                        className="text-ink-400 hover:text-ink-900 transition-colors p-1 rounded hover:bg-ink-100"
                        title="全局配置"
                    >
                        <Settings size={14} />
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {isLoading ? (
                    // Skeleton
                    [1, 2, 3, 4].map(i => (
                        <div key={i} className="h-24 bg-ink-50 animate-pulse rounded-lg" />
                    ))
                ) : (
                    <>
                        {ROLES.map(role => {
                            const assignedProfileId = assignments[role.id];
                            const assignedProfile = profiles.find(p => p.id === assignedProfileId);
                            const Icon = role.icon;

                            return (
                                <div
                                    key={role.id}
                                    className="group flex flex-col gap-2 p-3 rounded-lg border border-border bg-background hover:border-primary/30 transition-all duration-200"
                                >
                                    {/* Role Header */}
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <div className={cn("p-1.5 rounded-md text-ink-600 bg-ink-50",
                                                role.id === 'writer' && "text-primary bg-primary/10"
                                            )}>
                                                <Icon size={16} />
                                            </div>
                                            <div>
                                                <div className="text-sm font-bold leading-none">{role.label}</div>
                                                <div className="text-[10px] text-ink-400 font-medium uppercase tracking-wider mt-0.5">{role.eng}</div>
                                            </div>
                                        </div>
                                        {/* Status removed as per request */}
                                        <div />
                                    </div>

                                    {/* Model Selector */}
                                    <div className="mt-1">
                                        <select
                                            value={assignedProfileId || ''}
                                            onChange={(e) => handleAssignmentChange(role.id, e.target.value)}
                                            className="w-full text-xs py-1.5 px-2 bg-ink-50/50 border border-border rounded hover:border-primary/50 focus:border-primary focus:ring-1 focus:ring-primary/20 outline-none transition-colors appearance-none cursor-pointer text-ink-700 font-medium"
                                            style={{ backgroundImage: 'none' }} // Remove default arrow if customized
                                        >
                                            <option value="" disabled>选择模型...</option>
                                            {profiles.map(p => (
                                                <option key={p.id} value={p.id}>
                                                    {p.name} ({p.model})
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            );
                        })}

                        <div className="pt-4 border-t border-border mt-2 space-y-4">
                            {/* Available Models List */}
                            <div>
                                <div className="px-1 text-xs text-ink-400 mb-2 font-medium flex items-center justify-between">
                                    <span>可用模型</span>
                                    <button
                                        onClick={() => setIsModalOpen(true)}
                                        className="hover:text-primary transition-colors p-1"
                                        title="添加新模型"
                                    >
                                        <Plus size={14} />
                                    </button>
                                </div>
                                <div className="space-y-2">
                                    {profiles.map(p => (
                                        <div key={p.id} className="bg-background border border-border rounded p-2 text-xs flex flex-col gap-1 hover:border-primary/30 transition-colors">
                                            <div className="font-bold text-ink-800">{p.name}</div>
                                            <div className="flex justify-between text-ink-400">
                                                <span>{p.provider}</span>
                                                <span className="font-mono bg-ink-50 px-1 rounded">{p.model}</span>
                                            </div>
                                        </div>
                                    ))}
                                    {profiles.length === 0 && (
                                        <div className="text-center py-4 text-xs text-ink-400 border border-dashed border-border rounded">
                                            暂无模型，点击右上角添加
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Modal */}
            <AnimatePresence>
                {isModalOpen && (
                    <LLMProfileModal
                        open={isModalOpen}
                        onClose={() => setIsModalOpen(false)}
                        onSave={handleSaveProfile}
                    />
                )}
            </AnimatePresence>
        </div>
    );
};

export default AgentsPanel;
