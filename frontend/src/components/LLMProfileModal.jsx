import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Save, X, Shield, Cpu, Key, Globe, Box, Server, Sparkles, Moon, Zap, MessageCircle, Terminal, RefreshCw } from 'lucide-react';
import { Button, Input, Card } from './ui/core';
import { configAPI } from '../api';

export default function LLMProfileModal({ open, profile, onClose, onSave }) {
    const [fetchedModels, setFetchedModels] = useState([]);
    const [fetchingModels, setFetchingModels] = useState(false);



    const [formData, setFormData] = useState({
        name: '',
        provider: 'openai',
        api_key: '',
        model: '',
        base_url: '',
        temperature: 0.7,
        max_tokens: 8000
    });

    useEffect(() => {
        if (open) {
            if (profile) {
                setFormData({
                    id: profile.id,
                    name: profile.name || '',
                    provider: profile.provider || 'openai',
                    api_key: profile.api_key || '',
                    model: profile.model || '',
                    base_url: profile.base_url || '',
                    temperature: profile.temperature || 0.7,
                    max_tokens: profile.max_tokens || 8000
                });
            } else {
                setFormData({
                    name: '新建卡片',
                    provider: 'openai',
                    api_key: '',
                    model: '',
                    base_url: '',
                    temperature: 0.7,
                    max_tokens: 8000
                });
            }
        }
    }, [open, profile]);

    if (!open) return null;

    const PROVIDERS = [
        { id: 'anthropic', label: 'Anthropic', icon: Cpu },
        { id: 'deepseek', label: 'DeepSeek', icon: Box },
        { id: 'gemini', label: 'Gemini (Google)', icon: Sparkles },
        { id: 'glm', label: 'GLM (智谱)', icon: Zap },
        { id: 'grok', label: 'Grok (xAI)', icon: Terminal },
        { id: 'kimi', label: 'Kimi (月之暗面)', icon: Moon },
        { id: 'openai', label: 'OpenAI', icon: Shield },
        { id: 'qwen', label: 'Qwen (通义千问)', icon: MessageCircle },
        { id: 'custom', label: '自定义 / 本地模型', icon: Server },
        { id: 'mock', label: '模拟测试 (Mock)', icon: Globe },
    ].sort((a, b) => a.label.localeCompare(b.label));

    const OPENAI_MODELS = [
        { id: 'gpt-4o', label: 'GPT-4o' },
        { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
        { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
    ];

    const ANTHROPIC_MODELS = [
        { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
        { id: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
        { id: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku' },
    ];

    const DEEPSEEK_MODELS = [
        { id: 'deepseek-chat', label: 'DeepSeek-V3' },
        { id: 'deepseek-reasoner', label: 'DeepSeek-R1 (Reasoner)' },
    ];

    const GEMINI_MODELS = [
        { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
        { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    ];

    const GROK_MODELS = [
        { id: 'grok-2', label: 'Grok 2' },
        { id: 'grok-beta', label: 'Grok Beta' },
    ];

    const KIMI_MODELS = [
        { id: 'moonshot-v1-8k', label: 'Moonshot V1 8k' },
        { id: 'moonshot-v1-32k', label: 'Moonshot V1 32k' },
        { id: 'moonshot-v1-128k', label: 'Moonshot V1 128k' },
    ];

    const GLM_MODELS = [
        { id: 'glm-4', label: 'GLM-4' },
        { id: 'glm-4-air', label: 'GLM-4 Air' },
        { id: 'glm-4-flash', label: 'GLM-4 Flash' },
    ];

    const QWEN_MODELS = [
        { id: 'qwen-turbo', label: 'Qwen Turbo' },
        { id: 'qwen-plus', label: 'Qwen Plus' },
        { id: 'qwen-max', label: 'Qwen Max' },
    ];

    const handleFetchModels = async () => {
        if (!formData.api_key) {
            alert("请先填写 API 密钥");
            return;
        }

        setFetchingModels(true);
        try {
            const res = await configAPI.fetchModels({
                provider: formData.provider,
                api_key: formData.api_key,
                base_url: formData.base_url
            });

            if (res.data && res.data.models) {
                setFetchedModels(res.data.models);
                // Auto-select first model if current model is empty
                if (!formData.model && res.data.models.length > 0) {
                    setFormData(prev => ({ ...prev, model: res.data.models[0] }));
                }
            }
        } catch (error) {
            console.error("Failed to fetch models", error);
            const errorMsg = error.response?.data?.detail || error.message;
            alert(`获取模型列表失败: ${errorMsg}\n\n提示: 请检查您选择的[模型提供商]是否与输入的API Key一致。`);
        } finally {
            setFetchingModels(false);
        }
    };

    const handleSave = () => {
        onSave(formData);
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
        >
            <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-surface w-full max-w-2xl rounded-xl shadow-2xl border border-border flex flex-col max-h-[90vh]"
            >
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-border">
                    <h2 className="text-xl font-bold font-serif text-ink-900 flex items-center gap-2">
                        {profile ? '编辑配置卡片' : '新建配置卡片'}
                    </h2>
                    <motion.div whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }}>
                        <Button variant="ghost" size="icon" onClick={onClose}>
                            <X size={20} />
                        </Button>
                    </motion.div>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">

                    {/* Basic Info */}
                    <div className="grid grid-cols-2 gap-4">
                        <motion.div
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.1 }}
                            className="space-y-2"
                        >
                            <label className="text-xs font-semibold text-ink-500 uppercase">卡片名称</label>
                            <Input
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder="例如：主力创作模型"
                            />
                        </motion.div>
                        <motion.div
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.15 }}
                            className="space-y-2"
                        >
                            <label className="text-xs font-semibold text-ink-500 uppercase">模型提供商</label>
                            <select
                                value={formData.provider}
                                onChange={(e) => {
                                    const newProvider = e.target.value;
                                    let defaultModel = '';
                                    if (newProvider === 'openai') defaultModel = 'gpt-4o';
                                    if (newProvider === 'anthropic') defaultModel = 'claude-3-5-sonnet-20241022';
                                    if (newProvider === 'deepseek') defaultModel = 'deepseek-chat';
                                    if (newProvider === 'gemini') defaultModel = 'gemini-1.5-pro';
                                    if (newProvider === 'grok') defaultModel = 'grok-beta';
                                    if (newProvider === 'kimi') defaultModel = 'moonshot-v1-8k';
                                    if (newProvider === 'glm') defaultModel = 'glm-4';
                                    if (newProvider === 'qwen') defaultModel = 'qwen-turbo';

                                    setFormData({
                                        ...formData,
                                        provider: newProvider,
                                        model: defaultModel
                                    });
                                }}
                                className="w-full px-3 py-2 border border-border rounded bg-surface text-ink-900 focus:outline-none focus:border-primary transition-colors"
                            >
                                {PROVIDERS.map(p => (
                                    <option key={p.id} value={p.id}>{p.label}</option>
                                ))}
                            </select>
                        </motion.div>
                    </div>

                    {/* Dynamic Fields */}
                    <div className="space-y-4 pt-4 border-t border-border/50">
                        {/* API KEY */}
                        <AnimatePresence>
                            {formData.provider !== 'mock' && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="space-y-2"
                                >
                                    <label className="text-xs font-semibold text-ink-500 uppercase">API 密钥</label>
                                    <Input
                                        type="password"
                                        value={formData.api_key}
                                        onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                                        placeholder="sk-..."
                                    />
                                    <p className="text-xs text-ink-400">配置将加密存储在本地文件中。</p>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Base URL (Custom Only) */}
                        <AnimatePresence>
                            {formData.provider === 'custom' && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="space-y-2"
                                >
                                    <label className="text-xs font-semibold text-ink-500 uppercase">API 基础地址</label>
                                    <Input
                                        value={formData.base_url}
                                        onChange={(e) => setFormData({ ...formData, base_url: e.target.value })}
                                        placeholder="https://api.example.com/v1"
                                    />
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Model Selection */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.2 }}
                            className="space-y-2"
                        >
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-semibold text-ink-500 uppercase">模型选择</label>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 text-[10px] text-primary hover:bg-primary/10"
                                    onClick={handleFetchModels}
                                    disabled={fetchingModels || !formData.api_key}
                                >
                                    {fetchingModels ? (
                                        <RefreshCw size={10} className="animate-spin mr-1" />
                                    ) : (
                                        <RefreshCw size={10} className="mr-1" />
                                    )}
                                    获取已部署模型
                                </Button>
                            </div>
                            {formData.provider === 'openai' ? (
                                <select
                                    value={formData.model}
                                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                                    className="w-full px-3 py-2 border border-border rounded bg-surface text-ink-900 focus:outline-none focus:border-primary transition-colors"
                                >
                                    <option value="">请选择模型...</option>
                                    {(fetchedModels.length > 0 ? fetchedModels : OPENAI_MODELS).map(m => (
                                        <option key={m.id || m} value={m.id || m}>{m.label || m}</option>
                                    ))}
                                </select>
                            ) : formData.provider === 'anthropic' ? (
                                <select
                                    value={formData.model}
                                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                                    className="w-full px-3 py-2 border border-border rounded bg-surface text-ink-900 focus:outline-none focus:border-primary transition-colors"
                                >
                                    <option value="">请选择模型...</option>
                                    {(fetchedModels.length > 0 ? fetchedModels : ANTHROPIC_MODELS).map(m => (
                                        <option key={m.id || m} value={m.id || m}>{m.label || m}</option>
                                    ))}
                                </select>
                            ) : formData.provider === 'deepseek' ? (
                                <select
                                    value={formData.model}
                                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                                    className="w-full px-3 py-2 border border-border rounded bg-surface text-ink-900 focus:outline-none focus:border-primary transition-colors"
                                >
                                    <option value="">请选择模型...</option>
                                    {(fetchedModels.length > 0 ? fetchedModels : DEEPSEEK_MODELS).map(m => (
                                        <option key={m.id || m} value={m.id || m}>{m.label || m}</option>
                                    ))}
                                </select>
                            ) : formData.provider === 'gemini' ? (
                                <select
                                    value={formData.model}
                                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                                    className="w-full px-3 py-2 border border-border rounded bg-surface text-ink-900 focus:outline-none focus:border-primary transition-colors"
                                >
                                    <option value="">请选择模型...</option>
                                    {GEMINI_MODELS.map(m => (
                                        <option key={m.id} value={m.id}>{m.label}</option>
                                    ))}
                                </select>
                            ) : formData.provider === 'grok' ? (
                                <select
                                    value={formData.model}
                                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                                    className="w-full px-3 py-2 border border-border rounded bg-surface text-ink-900 focus:outline-none focus:border-primary transition-colors"
                                >
                                    <option value="">请选择模型...</option>
                                    {GROK_MODELS.map(m => (
                                        <option key={m.id} value={m.id}>{m.label}</option>
                                    ))}
                                </select>
                            ) : formData.provider === 'kimi' ? (
                                <select
                                    value={formData.model}
                                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                                    className="w-full px-3 py-2 border border-border rounded bg-surface text-ink-900 focus:outline-none focus:border-primary transition-colors"
                                >
                                    <option value="">请选择模型...</option>
                                    {KIMI_MODELS.map(m => (
                                        <option key={m.id} value={m.id}>{m.label}</option>
                                    ))}
                                </select>
                            ) : formData.provider === 'glm' ? (
                                <select
                                    value={formData.model}
                                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                                    className="w-full px-3 py-2 border border-border rounded bg-surface text-ink-900 focus:outline-none focus:border-primary transition-colors"
                                >
                                    <option value="">请选择模型...</option>
                                    {GLM_MODELS.map(m => (
                                        <option key={m.id} value={m.id}>{m.label}</option>
                                    ))}
                                </select>
                            ) : formData.provider === 'qwen' ? (
                                <select
                                    value={formData.model}
                                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                                    className="w-full px-3 py-2 border border-border rounded bg-surface text-ink-900 focus:outline-none focus:border-primary transition-colors"
                                >
                                    <option value="">请选择模型...</option>
                                    {QWEN_MODELS.map(m => (
                                        <option key={m.id} value={m.id}>{m.label}</option>
                                    ))}
                                </select>
                            ) : (
                                <Input
                                    value={formData.model}
                                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                                    placeholder="例如：llama-2-70b"
                                />
                            )}
                        </motion.div>

                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.25 }}
                            className="grid grid-cols-2 gap-4"
                        >
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-ink-500 uppercase">
                                    随机性 (Temperature): {formData.temperature}
                                </label>
                                <input
                                    type="range"
                                    min="0" max="2" step="0.1"
                                    value={formData.temperature}
                                    onChange={(e) => setFormData({ ...formData, temperature: parseFloat(e.target.value) })}
                                    className="w-full accent-primary"
                                />
                            </div>
                        </motion.div>

                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-border bg-surface/50 flex justify-end gap-3 rounded-b-xl">
                    <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                        <Button variant="ghost" onClick={onClose}>取消</Button>
                    </motion.div>
                    <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                        <Button onClick={handleSave} className="shadow-md">
                            <Save size={16} className="mr-2" />
                            保存卡片
                        </Button>
                    </motion.div>
                </div>
            </motion.div>
        </motion.div>
    );
}
