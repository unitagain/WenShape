/**
 * 文枢 WenShape - 深度上下文感知的智能体小说创作系统
 * WenShape - Deep Context-Aware Agent-Based Novel Writing System
 *
 * Copyright © 2025-2026 WenShape Team
 * License: PolyForm Noncommercial License 1.0.0
 *
 * 模块说明 / Module Description:
 *   模型管理页面 - LLM 配置卡与智能体分配管理
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import useSWR, { mutate } from 'swr';
import { Cpu, Plus, Edit2, Trash2, Bot, Save, Server, Shield, Box, Globe, RotateCcw, Sparkle } from 'lucide-react';
import { Card, Button } from '../components/ui/core';
import { configAPI } from '../api';
import LLMProfileModal from '../components/LLMProfileModal';
import { useLocale } from '../i18n';

const fetcher = (fn) => fn().then((res) => res.data);

/**
 * 骨架屏加载动画 / Skeleton Loader for Cards
 */
const ProfileCardSkeleton = () => (
    <div className="bg-[var(--vscode-bg)] border border-[var(--vscode-sidebar-border)] rounded-[6px] p-5 animate-pulse">
        <div className="flex justify-between items-start mb-4">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-[var(--vscode-list-hover)] rounded-[6px]" />
                <div>
                    <div className="h-4 w-24 bg-[var(--vscode-list-hover)] rounded mb-2" />
                    <div className="h-3 w-16 bg-[var(--vscode-list-hover)] rounded opacity-70" />
                </div>
            </div>
        </div>
        <div className="space-y-2">
            <div className="h-3 w-full bg-[var(--vscode-list-hover)] rounded opacity-70" />
            <div className="h-3 w-2/3 bg-[var(--vscode-list-hover)] rounded opacity-60" />
        </div>
    </div>
);

/**
 * Agents - 模型管理页
 * 负责模型配置卡与智能体分配配置，保持现有数据流与交互。
 */
function Agents() {
    const { t } = useLocale();

    const { data: profiles = [], isLoading: loadingProfiles } = useSWR(
        'llm-profiles',
        () => fetcher(configAPI.getProfiles),
        { revalidateOnFocus: false, dedupingInterval: 2000 }
    );

    const { data: assignments = {}, isLoading: loadingAssignments } = useSWR(
        'agent-assignments',
        () => fetcher(configAPI.getAssignments),
        { revalidateOnFocus: false }
    );

    const [localAssignments, setLocalAssignments] = useState({});
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProfile, setEditingProfile] = useState(null);
    const [savingAssignments, setSavingAssignments] = useState(false);

    const currentAssignments = { ...assignments, ...localAssignments };

    const handleEditProfile = (profile) => {
        setEditingProfile(profile);
        setIsModalOpen(true);
    };

    const handleCreateProfile = () => {
        setEditingProfile(null);
        setIsModalOpen(true);
    };

    const deleteProfileAndRefresh = async (id) => {
        await configAPI.deleteProfile(id);
        mutate('llm-profiles');
        mutate('agent-assignments');
    };

    const handleDeleteProfile = async (id) => {
        if (!window.confirm(t('agents.deleteProfileConfirm'))) return;
        try {
            await deleteProfileAndRefresh(id);
        } catch (e) {
            alert(t('agents.deleteProfileFailed'));
        }
    };

    const handleSaveProfile = async (profileData) => {
        try {
            await configAPI.saveProfile(profileData);
            setIsModalOpen(false);
            mutate('llm-profiles');
        } catch (e) {
            alert(t('agents.saveProfileFailed'));
        }
    };

    const handleSaveAssignments = async () => {
        setSavingAssignments(true);
        try {
            await configAPI.updateAssignments(currentAssignments);
            mutate('agent-assignments');
            setLocalAssignments({});
            alert(t('agents.assignmentsSaved'));
        } catch (e) {
            alert(t('agents.saveAssignmentsFailed'));
        } finally {
            setSavingAssignments(false);
        }
    };

    const getProviderIcon = (p) => {
        switch (p) {
            case 'openai': return Shield;
            case 'anthropic': return Cpu;
            case 'deepseek': return Box;
            case 'gemini': return Sparkle;
            case 'custom': return Server;
            default: return Globe;
        }
    };

    const loading = loadingProfiles || loadingAssignments;

    const agentDefs = [
        { id: 'archivist', label: t('agents.agentRoles.archivistLabel'), desc: t('agents.agentRoles.archivistDesc') },
        { id: 'writer',    label: t('agents.agentRoles.writerLabel'),    desc: t('agents.agentRoles.writerDesc') },
        { id: 'editor',    label: t('agents.agentRoles.editorLabel'),    desc: t('agents.agentRoles.editorDesc') },
    ];

    return (
        <div className="anti-theme h-full overflow-y-auto p-8 bg-[var(--vscode-bg)] text-[var(--vscode-fg)]">
            <div className="max-w-6xl mx-auto space-y-10 pb-20">

                {/* 头部 */}
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    className="flex items-center justify-between pb-4 border-b border-[var(--vscode-sidebar-border)]"
                >
                    <div>
                        <h2 className="text-2xl font-serif font-bold text-ink-900 tracking-tight flex items-center gap-3">
                            <Bot className="text-[var(--vscode-focus-border)]" /> {t('agents.pageTitle')}
                        </h2>
                        <p className="text-ink-500 mt-2">{t('agents.pageSubtitle')}</p>
                    </div>
                    <Button variant="ghost" onClick={() => mutate('llm-profiles')} disabled={loading}>
                        <RotateCcw size={16} className={loading ? 'animate-spin mr-2' : 'mr-2'} /> {t('agents.refresh')}
                    </Button>
                </motion.div>

                {/* 模型配置卡片 */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.2, duration: 0.5 }}
                    className="space-y-4"
                >
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-bold text-ink-800">{t('agents.profilesSection')}</h3>
                        <Button onClick={handleCreateProfile} className="shadow-none">
                            <Plus size={16} className="mr-2" /> {t('agents.newProfile')}
                        </Button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {loadingProfiles && (
                            <>
                                <ProfileCardSkeleton />
                                <ProfileCardSkeleton />
                                <ProfileCardSkeleton />
                            </>
                        )}

                        <AnimatePresence>
                            {!loadingProfiles && profiles.map((profile, index) => {
                                const Icon = getProviderIcon(profile.provider);
                                return (
                                    <motion.div
                                        key={profile.id}
                                        initial={{ opacity: 0, scale: 0.9 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.2 } }}
                                        transition={{ delay: index * 0.05, duration: 0.3 }}
                                        className="bg-[var(--vscode-bg)] border border-[var(--vscode-sidebar-border)] rounded-[6px] p-5 hover:border-[var(--vscode-focus-border)] transition-colors shadow-none relative group cursor-pointer"
                                    >
                                        <div className="flex justify-between items-start mb-4">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 bg-[var(--vscode-list-hover)] rounded-[6px] text-[var(--vscode-fg)]">
                                                    <Icon size={20} />
                                                </div>
                                                <div>
                                                    <h4 className="font-bold text-ink-900">{profile.name}</h4>
                                                    <p className="text-xs text-ink-500 font-semibold tracking-wider">{profile.provider}</p>
                                                </div>
                                            </div>
                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-ink-400 hover:text-[var(--vscode-fg)]"
                                                    onClick={() => handleEditProfile(profile)}
                                                >
                                                    <Edit2 size={14} />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-ink-400 hover:text-red-500"
                                                    onClick={() => handleDeleteProfile(profile.id)}
                                                >
                                                    <Trash2 size={14} />
                                                </Button>
                                            </div>
                                        </div>

                                        <div className="space-y-1 text-sm text-ink-600">
                                            <div className="flex justify-between">
                                                <span className="text-ink-400">{t('agents.modelLabel')}</span>
                                                <span className="font-mono bg-[var(--vscode-list-hover)] px-1 rounded">{profile.model || t('agents.modelDefault')}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-ink-400">{t('agents.tempLabel')}</span>
                                                <span>{profile.temperature}</span>
                                            </div>
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </AnimatePresence>

                        {!loadingProfiles && profiles.length === 0 && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="col-span-full py-12 text-center border border-dashed border-[var(--vscode-sidebar-border)] rounded-[6px] bg-[var(--vscode-bg)]"
                            >
                                <p className="text-ink-400">{t('agents.noProfiles')}</p>
                                <Button variant="link" onClick={handleCreateProfile}>{t('agents.createFirst')}</Button>
                            </motion.div>
                        )}
                    </div>
                </motion.div>

                {/* 智能体角色分配 */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4, duration: 0.5 }}
                    className="space-y-4"
                >
                    <h3 className="text-lg font-bold text-ink-800">{t('agents.assignmentsSection')}</h3>
                    <Card className="bg-[var(--vscode-bg)] border border-[var(--vscode-sidebar-border)] overflow-hidden">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-[var(--vscode-sidebar-bg)] border-b border-[var(--vscode-sidebar-border)] text-xs font-semibold text-ink-500 tracking-wider">
                                    <th className="p-4">{t('agents.tableHeaders.role')}</th>
                                    <th className="p-4">{t('agents.tableHeaders.profile')}</th>
                                    <th className="p-4">{t('agents.tableHeaders.desc')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--vscode-sidebar-border)]">
                                {agentDefs.map((agent, index) => (
                                    <motion.tr
                                        key={agent.id}
                                        initial={{ opacity: 0, x: -20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: 0.5 + index * 0.1, duration: 0.3 }}
                                        className="hover:bg-[var(--vscode-list-hover)] transition-colors"
                                    >
                                        <td className="p-4 font-medium text-ink-900 flex items-center gap-2">
                                            <Bot size={16} className="text-[var(--vscode-fg-subtle)]" />
                                            {agent.label}
                                        </td>
                                        <td className="p-4">
                                            <div className="relative">
                                                <select
                                                    value={currentAssignments[agent.id] || ''}
                                                    onChange={(e) => setLocalAssignments({ ...localAssignments, [agent.id]: e.target.value })}
                                                    className="w-full md:w-64 px-3 py-2 border border-[var(--vscode-input-border)] rounded-[6px] bg-[var(--vscode-input-bg)] text-ink-900 text-sm focus:outline-none focus:border-[var(--vscode-focus-border)] focus:ring-2 focus:ring-[var(--vscode-focus-border)] cursor-pointer transition-colors hover:border-[var(--vscode-focus-border)]"
                                                >
                                                    <option value="">{t('agents.selectProfile')}</option>
                                                    {profiles.map(p => (
                                                        <option key={p.id} value={p.id}>{p.name} ({p.model})</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </td>
                                        <td className="p-4 text-sm text-ink-500 hidden md:table-cell">
                                            {agent.desc}
                                        </td>
                                    </motion.tr>
                                ))}
                            </tbody>
                        </table>
                        <div className="p-4 border-t border-[var(--vscode-sidebar-border)] bg-[var(--vscode-sidebar-bg)] flex justify-end">
                            <Button
                                onClick={handleSaveAssignments}
                                disabled={savingAssignments || profiles.length === 0}
                                className="shadow-none"
                            >
                                {savingAssignments ? <RotateCcw className="animate-spin mr-2" /> : <Save className="mr-2" />}
                                {savingAssignments ? t('agents.savingAssignments') : t('agents.saveAssignments')}
                            </Button>
                        </div>
                    </Card>
                </motion.div>

            </div>

            <AnimatePresence>
                {isModalOpen && (
                    <LLMProfileModal
                        open={isModalOpen}
                        profile={editingProfile}
                        onClose={() => setIsModalOpen(false)}
                        onSave={handleSaveProfile}
                        onDelete={async (id) => {
                            await deleteProfileAndRefresh(id);
                            setIsModalOpen(false);
                            setEditingProfile(null);
                        }}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}

export default Agents;
