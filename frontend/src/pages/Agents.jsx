import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import useSWR, { mutate } from 'swr';
import { Cpu, Plus, Edit2, Trash2, Bot, Save, Server, Shield, Box, Globe, RotateCcw } from 'lucide-react';
import { Card, Button } from '../components/ui/core';
import { configAPI } from '../api';
import LLMProfileModal from '../components/LLMProfileModal';

// SWR Fetcher
const fetcher = (fn) => fn().then(res => res.data);

// Skeleton Components
const ProfileCardSkeleton = () => (
    <div className="bg-surface border border-border rounded-xl p-5 animate-pulse">
        <div className="flex justify-between items-start mb-4">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-ink-100 rounded-lg" />
                <div>
                    <div className="h-4 w-24 bg-ink-100 rounded mb-2" />
                    <div className="h-3 w-16 bg-ink-50 rounded" />
                </div>
            </div>
        </div>
        <div className="space-y-2">
            <div className="h-3 w-full bg-ink-50 rounded" />
            <div className="h-3 w-2/3 bg-ink-50 rounded" />
        </div>
    </div>
);

function Agents() {
    // SWR Data Fetching with automatic caching
    const { data: profiles = [], error: profilesError, isLoading: loadingProfiles } = useSWR(
        'llm-profiles',
        () => fetcher(configAPI.getProfiles),
        {
            revalidateOnFocus: false,
            dedupingInterval: 2000
        }
    );

    const { data: assignments = {}, error: assignmentsError, isLoading: loadingAssignments } = useSWR(
        'agent-assignments',
        () => fetcher(configAPI.getAssignments),
        { revalidateOnFocus: false }
    );

    const [localAssignments, setLocalAssignments] = useState({});
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProfile, setEditingProfile] = useState(null);
    const [savingAssignments, setSavingAssignments] = useState(false);

    // Merge SWR data with local state
    const currentAssignments = { ...assignments, ...localAssignments };

    const handleEditProfile = (profile) => {
        setEditingProfile(profile);
        setIsModalOpen(true);
    };

    const handleCreateProfile = () => {
        setEditingProfile(null);
        setIsModalOpen(true);
    };

    const handleDeleteProfile = async (id) => {
        if (!window.confirm("确定要删除这张配置卡片吗？")) return;
        try {
            await configAPI.deleteProfile(id);
            mutate('llm-profiles'); // Refresh cache
        } catch (e) {
            alert("删除卡片失败");
        }
    };

    const handleSaveProfile = async (profileData) => {
        try {
            await configAPI.saveProfile(profileData);
            setIsModalOpen(false);
            mutate('llm-profiles'); // Refresh cache instantly
        } catch (e) {
            alert("保存卡片失败");
        }
    };

    const handleSaveAssignments = async () => {
        setSavingAssignments(true);
        try {
            await configAPI.updateAssignments(currentAssignments);
            mutate('agent-assignments');
            setLocalAssignments({});
            alert("智能体分配已保存！");
        } catch (e) {
            alert("保存分配失败");
        } finally {
            setSavingAssignments(false);
        }
    };

    const getProviderIcon = (p) => {
        switch (p) {
            case 'openai': return Shield;
            case 'anthropic': return Cpu;
            case 'deepseek': return Box;
            case 'custom': return Server;
            default: return Globe;
        }
    };

    const loading = loadingProfiles || loadingAssignments;

    return (
        <div className="h-full overflow-y-auto p-8 bg-background">
            <div className="max-w-6xl mx-auto space-y-10 pb-20">

                {/* Header with Fade-in Animation */}
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    className="flex items-center justify-between"
                >
                    <div>
                        <h2 className="text-3xl font-serif font-bold text-ink-900 tracking-tight flex items-center gap-3">
                            <Bot className="text-primary" /> 模型管理
                        </h2>
                        <p className="text-ink-500 mt-2">管理您的大语言模型配置卡片，并将其分配给特定的智能体角色。</p>
                    </div>
                    <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                        <Button variant="ghost" onClick={() => mutate('llm-profiles')} disabled={loading}>
                            <RotateCcw size={16} className={loading ? 'animate-spin mr-2' : 'mr-2'} /> 刷新
                        </Button>
                    </motion.div>
                </motion.div>

                {/* Section 1: Profiles (Cards) */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.2, duration: 0.5 }}
                    className="space-y-4"
                >
                    <div className="flex items-center justify-between">
                        <h3 className="text-xl font-bold text-ink-800">1. 模型配置卡片</h3>
                        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                            <Button onClick={handleCreateProfile} className="shadow-sm">
                                <Plus size={16} className="mr-2" /> 新建卡片
                            </Button>
                        </motion.div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {/* Skeleton Loading State */}
                        {loadingProfiles && (
                            <>
                                <ProfileCardSkeleton />
                                <ProfileCardSkeleton />
                                <ProfileCardSkeleton />
                            </>
                        )}

                        {/* Animated Profile Cards */}
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
                                        whileHover={{ y: -4, transition: { duration: 0.2 } }}
                                        className="bg-surface border border-border rounded-xl p-5 hover:border-primary/50 transition-colors shadow-sm relative group cursor-pointer"
                                    >
                                        <div className="flex justify-between items-start mb-4">
                                            <div className="flex items-center gap-3">
                                                <motion.div
                                                    whileHover={{ rotate: 360 }}
                                                    transition={{ duration: 0.5 }}
                                                    className="p-2 bg-primary/10 rounded-lg text-primary"
                                                >
                                                    <Icon size={20} />
                                                </motion.div>
                                                <div>
                                                    <h4 className="font-bold text-ink-900">{profile.name}</h4>
                                                    <p className="text-xs text-ink-500 uppercase font-semibold tracking-wider">{profile.provider}</p>
                                                </div>
                                            </div>
                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-ink-400 hover:text-primary"
                                                        onClick={() => handleEditProfile(profile)}
                                                    >
                                                        <Edit2 size={14} />
                                                    </Button>
                                                </motion.div>
                                                <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-ink-400 hover:text-red-500"
                                                        onClick={() => handleDeleteProfile(profile.id)}
                                                    >
                                                        <Trash2 size={14} />
                                                    </Button>
                                                </motion.div>
                                            </div>
                                        </div>

                                        <div className="space-y-1 text-sm text-ink-600">
                                            <div className="flex justify-between">
                                                <span className="text-ink-400">模型：</span>
                                                <span className="font-mono bg-ink-50 px-1 rounded">{profile.model || 'Default'}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-ink-400">温度：</span>
                                                <span>{profile.temperature}</span>
                                            </div>
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </AnimatePresence>

                        {/* Empty State */}
                        {!loadingProfiles && profiles.length === 0 && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="col-span-full py-12 text-center border-2 border-dashed border-border rounded-xl bg-surface/30"
                            >
                                <p className="text-ink-400">暂无配置卡片。</p>
                                <Button variant="link" onClick={handleCreateProfile}>创建第一张卡片</Button>
                            </motion.div>
                        )}
                    </div>
                </motion.div>

                {/* Section 2: Assignments */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4, duration: 0.5 }}
                    className="space-y-4"
                >
                    <h3 className="text-xl font-bold text-ink-800">2. 智能体角色分配</h3>
                    <Card className="bg-surface overflow-hidden">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-ink-50 border-b border-border text-xs font-semibold text-ink-500 uppercase tracking-wider">
                                    <th className="p-4">智能体角色</th>
                                    <th className="p-4">指定配置卡片</th>
                                    <th className="p-4">职责描述</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {[
                                    { id: 'archivist', label: '资料管理员 (Archivist)', desc: '管理设定资料，检索百科，维护世界观一致性。' },
                                    { id: 'writer', label: '撰稿人 (Writer)', desc: '负责撰写章节正文与场景描写。' },
                                    { id: 'reviewer', label: '审稿人 (Reviewer)', desc: '评估草稿质量，提供修改建议。' },
                                    { id: 'editor', label: '编辑 (Editor)', desc: '润色文笔，修正语法错误。' },
                                ].map((agent, index) => (
                                    <motion.tr
                                        key={agent.id}
                                        initial={{ opacity: 0, x: -20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: 0.5 + index * 0.1, duration: 0.3 }}
                                        className="hover:bg-ink-50/50 transition-colors"
                                    >
                                        <td className="p-4 font-medium text-ink-900 flex items-center gap-2">
                                            <Bot size={16} className="text-primary/70" />
                                            {agent.label}
                                        </td>
                                        <td className="p-4">
                                            <motion.div
                                                whileHover={{ scale: 1.02 }}
                                                whileTap={{ scale: 0.98 }}
                                                className="relative"
                                            >
                                                <select
                                                    value={currentAssignments[agent.id] || ''}
                                                    onChange={(e) => setLocalAssignments({ ...localAssignments, [agent.id]: e.target.value })}
                                                    className="w-full md:w-64 px-3 py-2 border border-border rounded bg-background text-ink-900 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 cursor-pointer transition-all hover:border-primary/50 hover:shadow-sm"
                                                >
                                                    <option value="">-- 选择卡片 --</option>
                                                    {profiles.map(p => (
                                                        <option key={p.id} value={p.id}>{p.name} ({p.model})</option>
                                                    ))}
                                                </select>
                                            </motion.div>
                                        </td>
                                        <td className="p-4 text-sm text-ink-500 hidden md:table-cell">
                                            {agent.desc}
                                        </td>
                                    </motion.tr>
                                ))}
                            </tbody>
                        </table>
                        <div className="p-4 border-t border-border bg-ink-50/30 flex justify-end">
                            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                                <Button
                                    onClick={handleSaveAssignments}
                                    disabled={savingAssignments || profiles.length === 0}
                                    className="shadow-md"
                                >
                                    {savingAssignments ? <RotateCcw className="animate-spin mr-2" /> : <Save className="mr-2" />}
                                    保存分配设置
                                </Button>
                            </motion.div>
                        </div>
                    </Card>
                </motion.div>

            </div>

            {/* Modal with Animation */}
            <AnimatePresence>
                {isModalOpen && (
                    <LLMProfileModal
                        open={isModalOpen}
                        profile={editingProfile}
                        onClose={() => setIsModalOpen(false)}
                        onSave={handleSaveProfile}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}

export default Agents;
