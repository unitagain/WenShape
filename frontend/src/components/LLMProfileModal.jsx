/**
 * 文枢 WenShape - 深度上下文感知的智能体小说创作系统
 * WenShape - Deep Context-Aware Agent-Based Novel Writing System
 *
 * Copyright © 2025-2026 WenShape Team
 * License: PolyForm Noncommercial License 1.0.0
 *
 * 模块说明 / Module Description:
 *   LLM 配置对话框 - 创建和编辑 LLM 提供商配置文件（API密钥、模型选择等）
 *   LLM profile modal for creating and editing provider configurations.
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Save, X, RefreshCw, Trash2 } from 'lucide-react';
import { Button, Input } from './ui/core';
import { configAPI } from '../api';
import logger from '../utils/logger';
import { useLocale } from '../i18n';

/**
 * LLM 配置对话框 - 创建和编辑 LLM 提供商配置
 *
 * Modal for creating and editing LLM provider profiles (API keys, model selection, parameters).
 * Preserves data structure and interaction semantics without modification.
 *
 * @component
 * @example
 * return (
 *   <LLMProfileModal
 *     open={true}
 *     profile={existingProfile}
 *     onClose={handleClose}
 *     onSave={handleSave}
 *     onDelete={handleDelete}
 *   />
 * )
 *
 * @param {Object} props - Component props
 * @param {boolean} [props.open=false] - 对话框是否打开 / Whether dialog is open
 * @param {Object} [props.profile=null] - 现有配置文件 / Existing profile to edit
 * @param {Function} [props.onClose] - 关闭回调 / Close callback
 * @param {Function} [props.onSave] - 保存回调 / Save callback
 * @param {Function} [props.onDelete] - 删除回调 / Delete callback
 * @returns {JSX.Element} LLM 配置对话框 / LLM profile modal element
 */
export default function LLMProfileModal({ open, profile, onClose, onSave, onDelete }) {
    const { t } = useLocale();
    const [fetchedModels, setFetchedModels] = useState([]);
    const [fetchingModels, setFetchingModels] = useState(false);
    const [fetchWarning, setFetchWarning] = useState('');
    const [deleting, setDeleting] = useState(false);

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
            setFetchedModels([]);
            setFetchWarning('');
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
                    name: t('llmModal.defaultName'),
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
        { id: 'anthropic', label: 'Anthropic（Claude）' },
        { id: 'deepseek', label: 'DeepSeek' },
        { id: 'gemini', label: 'Gemini（Google，含免费试用模型）' },
        { id: 'glm', label: 'GLM（智谱）' },
        { id: 'grok', label: 'Grok（xAI）' },
        { id: 'kimi', label: 'Kimi（月之暗面）' },
        { id: 'openai', label: 'OpenAI' },
        { id: 'qwen', label: 'Qwen（通义千问）' },
        { id: 'custom', label: t('llmModal.providerCustom') },
        { id: 'mock', label: t('llmModal.providerMock') },
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
        { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash（免费对话20次）' },
        { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview（免费对话20次）' },
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
            alert(t('llmModal.pleaseEnterKey'));
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
                setFetchWarning(res.data.warning ? String(res.data.warning) : '');
                // 当前未选择时自动填充第一个模型
                if (!formData.model && res.data.models.length > 0) {
                    setFormData(prev => ({ ...prev, model: res.data.models[0] }));
                }
            }
        } catch (error) {
            logger.error("Failed to fetch models", error);
            setFetchWarning('');
            const errorMsg = error.response?.data?.detail || error.message;
            alert(t('llmModal.fetchFailed', { message: errorMsg }));
        } finally {
            setFetchingModels(false);
        }
    };

    const handleSave = () => {
        onSave(formData);
    };

    const handleDelete = async () => {
        const profileId = formData.id || profile?.id;
        if (!profileId) return;

        if (!window.confirm(t('llmModal.deleteConfirm'))) return;

        try {
            setDeleting(true);
            if (onDelete) {
                await onDelete(profileId);
            } else {
                await configAPI.deleteProfile(profileId);
            }
            onClose();
        } catch (e) {
            alert(t('llmModal.deleteFailed'));
        } finally {
            setDeleting(false);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="anti-theme fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20"
            onClick={onClose}
        >
            <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-[var(--vscode-bg)] text-[var(--vscode-fg)] w-full max-w-2xl rounded-[6px] border border-[var(--vscode-sidebar-border)] flex flex-col max-h-[90vh] shadow-none"
            >
                {/* 头部 */}
                <div className="flex items-center justify-between p-6 border-b border-[var(--vscode-sidebar-border)] bg-[var(--vscode-sidebar-bg)]">
                    <h2 className="text-xl font-bold text-[var(--vscode-fg)] flex items-center gap-2">
                        {profile ? t('llmModal.editTitle') : t('llmModal.createTitle')}
                    </h2>
                    <Button variant="ghost" size="icon" onClick={onClose} className="text-[var(--vscode-fg)] border border-[var(--vscode-input-border)] hover:bg-[var(--vscode-list-hover)] shadow-none">
                        <X size={20} />
                    </Button>
                </div>

                {/* 内容 */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">

                    {/* 基础信息 */}
                    <div className="grid grid-cols-2 gap-4">
                        <motion.div
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.1 }}
                            className="space-y-2"
                        >
                            <label className="text-xs font-semibold text-[var(--vscode-fg-subtle)] uppercase">{t('llmModal.nameLabel')}</label>
                            <Input
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder={t('llmModal.namePlaceholder')}
                                className="bg-[var(--vscode-input-bg)] border-[var(--vscode-input-border)] text-[var(--vscode-fg)] focus-visible:border-[var(--vscode-focus-border)] focus-visible:ring-[var(--vscode-focus-border)]"
                            />
                        </motion.div>
                        <motion.div
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.15 }}
                            className="space-y-2"
                        >
                            <label className="text-xs font-semibold text-[var(--vscode-fg-subtle)] uppercase">{t('llmModal.providerLabel')}</label>
                            <select
                                value={formData.provider}
                                onChange={(e) => {
                                    const newProvider = e.target.value;
                                    let defaultModel = '';
                                    if (newProvider === 'openai') defaultModel = 'gpt-4o';
                                    if (newProvider === 'anthropic') defaultModel = 'claude-3-5-sonnet-20241022';
                                    if (newProvider === 'deepseek') defaultModel = 'deepseek-chat';
                                    if (newProvider === 'gemini') defaultModel = 'gemini-2.5-flash';
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
                                className="w-full px-3 py-2 border border-[var(--vscode-input-border)] rounded-[6px] bg-[var(--vscode-input-bg)] text-[var(--vscode-fg)] focus:outline-none focus:border-[var(--vscode-focus-border)] transition-none"
                            >
                                {PROVIDERS.map(p => (
                                    <option key={p.id} value={p.id}>{p.label}</option>
                                ))}
                            </select>
                        </motion.div>
                    </div>

                    {/* 动态字段 */}
                    <div className="space-y-4 pt-4 border-t border-[var(--vscode-sidebar-border)]">
                        {/* 接口密钥 */}
                        <AnimatePresence>
                            {formData.provider !== 'mock' && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="space-y-2"
                                >
                                    <label className="text-xs font-semibold text-[var(--vscode-fg-subtle)] uppercase">{t('llmModal.apiKeyLabel')}</label>
                                    <Input
                                        type="password"
                                        value={formData.api_key}
                                        onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                                        placeholder="sk-..."
                                        className="bg-[var(--vscode-input-bg)] border-[var(--vscode-input-border)] text-[var(--vscode-fg)] focus-visible:border-[var(--vscode-focus-border)] focus-visible:ring-[var(--vscode-focus-border)]"
                                    />
                                    <p className="text-xs text-[var(--vscode-fg-subtle)]">{t('llmModal.apiKeyNote')}</p>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* 接口地址（仅自定义） */}
                        <AnimatePresence>
                            {formData.provider === 'custom' && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="space-y-2"
                                >
                                    <label className="text-xs font-semibold text-[var(--vscode-fg-subtle)] uppercase">{t('llmModal.baseUrlLabel')}</label>
                                    <Input
                                        value={formData.base_url}
                                        onChange={(e) => setFormData({ ...formData, base_url: e.target.value })}
                                        placeholder="https://api.example.com/v1"
                                        className="bg-[var(--vscode-input-bg)] border-[var(--vscode-input-border)] text-[var(--vscode-fg)] focus-visible:border-[var(--vscode-focus-border)] focus-visible:ring-[var(--vscode-focus-border)]"
                                    />
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* 模型选择 */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.2 }}
                            className="space-y-2"
                        >
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-semibold text-[var(--vscode-fg-subtle)] uppercase">{t('llmModal.modelLabel')}</label>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 text-[10px] text-[var(--vscode-fg)] hover:bg-[var(--vscode-list-hover)] border border-[var(--vscode-input-border)] shadow-none"
                                    onClick={handleFetchModels}
                                    disabled={fetchingModels || !formData.api_key}
                                >
                                    {fetchingModels ? (
                                        <RefreshCw size={10} className="animate-spin mr-1" />
                                    ) : (
                                        <RefreshCw size={10} className="mr-1" />
                                    )}
                                    {fetchingModels ? t('llmModal.fetching') : t('llmModal.fetchModels')}
                                </Button>
                            </div>
                            {formData.provider === 'openai' ? (
                                <select
                                    value={formData.model}
                                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                                    className="w-full px-3 py-2 border border-[var(--vscode-input-border)] rounded-[6px] bg-[var(--vscode-input-bg)] text-[var(--vscode-fg)] focus:outline-none focus:border-[var(--vscode-focus-border)] transition-none"
                                >
                                    <option value="">{t('llmModal.modelPlaceholder')}</option>
                                    {(fetchedModels.length > 0 ? fetchedModels : OPENAI_MODELS).map(m => (
                                        <option key={m.id || m} value={m.id || m}>{m.label || m}</option>
                                    ))}
                                </select>
                            ) : formData.provider === 'anthropic' ? (
                                <select
                                    value={formData.model}
                                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                                    className="w-full px-3 py-2 border border-[var(--vscode-input-border)] rounded-[6px] bg-[var(--vscode-input-bg)] text-[var(--vscode-fg)] focus:outline-none focus:border-[var(--vscode-focus-border)] transition-none"
                                >
                                    <option value="">{t('llmModal.modelPlaceholder')}</option>
                                    {(fetchedModels.length > 0 ? fetchedModels : ANTHROPIC_MODELS).map(m => (
                                        <option key={m.id || m} value={m.id || m}>{m.label || m}</option>
                                    ))}
                                </select>
                            ) : formData.provider === 'deepseek' ? (
                                <select
                                    value={formData.model}
                                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                                    className="w-full px-3 py-2 border border-[var(--vscode-input-border)] rounded-[6px] bg-[var(--vscode-input-bg)] text-[var(--vscode-fg)] focus:outline-none focus:border-[var(--vscode-focus-border)] transition-none"
                                >
                                    <option value="">{t('llmModal.modelPlaceholder')}</option>
                                    {(fetchedModels.length > 0 ? fetchedModels : DEEPSEEK_MODELS).map(m => (
                                        <option key={m.id || m} value={m.id || m}>{m.label || m}</option>
                                    ))}
                                </select>
                            ) : formData.provider === 'gemini' ? (
                                <select
                                    value={formData.model}
                                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                                    className="w-full px-3 py-2 border border-[var(--vscode-input-border)] rounded-[6px] bg-[var(--vscode-input-bg)] text-[var(--vscode-fg)] focus:outline-none focus:border-[var(--vscode-focus-border)] transition-none"
                                >
                                    <option value="">{t('llmModal.modelPlaceholder')}</option>
                                    {GEMINI_MODELS.map(m => (
                                        <option key={m.id} value={m.id}>{m.label}</option>
                                    ))}
                                </select>
                            ) : formData.provider === 'grok' ? (
                                <select
                                    value={formData.model}
                                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                                    className="w-full px-3 py-2 border border-[var(--vscode-input-border)] rounded-[6px] bg-[var(--vscode-input-bg)] text-[var(--vscode-fg)] focus:outline-none focus:border-[var(--vscode-focus-border)] transition-none"
                                >
                                    <option value="">{t('llmModal.modelPlaceholder')}</option>
                                    {GROK_MODELS.map(m => (
                                        <option key={m.id} value={m.id}>{m.label}</option>
                                    ))}
                                </select>
                            ) : formData.provider === 'kimi' ? (
                                <select
                                    value={formData.model}
                                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                                    className="w-full px-3 py-2 border border-[var(--vscode-input-border)] rounded-[6px] bg-[var(--vscode-input-bg)] text-[var(--vscode-fg)] focus:outline-none focus:border-[var(--vscode-focus-border)] transition-none"
                                >
                                    <option value="">{t('llmModal.modelPlaceholder')}</option>
                                    {KIMI_MODELS.map(m => (
                                        <option key={m.id} value={m.id}>{m.label}</option>
                                    ))}
                                </select>
                            ) : formData.provider === 'glm' ? (
                                <select
                                    value={formData.model}
                                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                                    className="w-full px-3 py-2 border border-[var(--vscode-input-border)] rounded-[6px] bg-[var(--vscode-input-bg)] text-[var(--vscode-fg)] focus:outline-none focus:border-[var(--vscode-focus-border)] transition-none"
                                >
                                    <option value="">{t('llmModal.modelPlaceholder')}</option>
                                    {GLM_MODELS.map(m => (
                                        <option key={m.id} value={m.id}>{m.label}</option>
                                    ))}
                                </select>
                            ) : formData.provider === 'qwen' ? (
                                <select
                                    value={formData.model}
                                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                                    className="w-full px-3 py-2 border border-[var(--vscode-input-border)] rounded-[6px] bg-[var(--vscode-input-bg)] text-[var(--vscode-fg)] focus:outline-none focus:border-[var(--vscode-focus-border)] transition-none"
                                >
                                    <option value="">{t('llmModal.modelPlaceholder')}</option>
                                    {QWEN_MODELS.map(m => (
                                        <option key={m.id} value={m.id}>{m.label}</option>
                                    ))}
                                </select>
                            ) : (
                                <Input
                                    value={formData.model}
                                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                                placeholder={t('llmModal.customModelPlaceholder')}
                                    className="bg-[var(--vscode-input-bg)] border-[var(--vscode-input-border)] text-[var(--vscode-fg)] focus-visible:border-[var(--vscode-focus-border)] focus-visible:ring-[var(--vscode-focus-border)]"
                                />
                            )}
                            {fetchWarning ? (
                                <div className="text-[11px] leading-snug text-[var(--vscode-fg-subtle)]">
                                    {fetchWarning}
                                </div>
                            ) : null}
                        </motion.div>

                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.25 }}
                            className="grid grid-cols-2 gap-4"
                        >
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-[var(--vscode-fg-subtle)] uppercase">
                                    {t('llmModal.temperatureLabel', { value: formData.temperature })}
                                </label>
                                <input
                                    type="range"
                                    min="0" max="2" step="0.1"
                                    value={formData.temperature}
                                    onChange={(e) => setFormData({ ...formData, temperature: parseFloat(e.target.value) })}
                                    className="w-full accent-[var(--vscode-focus-border)]"
                                />
                            </div>
                        </motion.div>

                    </div>
                </div>

                {/* 底部操作 */}
                <div className="p-6 border-t border-[var(--vscode-sidebar-border)] bg-[var(--vscode-sidebar-bg)] flex items-center justify-between gap-3">
                    {(formData.id || profile?.id) ? (
                        <Button
                            variant="ghost"
                            onClick={handleDelete}
                            disabled={deleting}
                            className="border border-[var(--vscode-input-border)] text-red-400 hover:bg-[var(--vscode-list-hover)] shadow-none"
                        >
                            <Trash2 size={16} className="mr-2" />
                            {t('llmModal.deleteBtn')}
                        </Button>
                    ) : (
                        <span />
                    )}

                    <div className="flex justify-end gap-3">
                        <Button
                            variant="ghost"
                            onClick={onClose}
                            disabled={deleting}
                            className="border border-[var(--vscode-input-border)] text-[var(--vscode-fg)] hover:bg-[var(--vscode-list-hover)] shadow-none"
                        >
                            {t('llmModal.cancelBtn')}
                        </Button>
                        <Button
                            onClick={handleSave}
                            disabled={deleting}
                            className="bg-[var(--vscode-list-active)] text-[var(--vscode-list-active-fg)] hover:opacity-90 shadow-none"
                        >
                            <Save size={16} className="mr-2" />
                            {t('llmModal.saveBtn')}
                        </Button>
                    </div>
                </div>
            </motion.div>
        </motion.div>
    );
}
