/**
 * 文枢 WenShape - 深度上下文感知的智能体小说创作系统
 * WenShape - Deep Context-Aware Agent-Based Novel Writing System
 *
 * Copyright © 2025-2026 WenShape Team
 * License: PolyForm Noncommercial License 1.0.0
 *
 * 模块说明 / Module Description:
 *   t('card.styleTitle')视图 - 管理项目的写作风格指导与自动提取功能
 *   Style view component for managing writing style guidelines and auto-extraction.
 */

import React, { useCallback, useState, useEffect } from 'react';
import { cardsAPI } from '../../api';
import { Button, Card } from '../ui/core';
import { RefreshCw, Feather, Sparkles, Save } from 'lucide-react';
import logger from '../../utils/logger';
import { useLocale } from '../../i18n';

/**
 * t('card.styleTitle')视图组件 - 管理项目的写作风格指导和自动提炼
 *
 * Component for managing and editing writing style guidelines for a project.
 * Supports manual input and automatic extraction from sample text.
 *
 * @component
 * @example
 * return (
 *   <StyleView projectId="proj-001" />
 * )
 *
 * @param {Object} props - Component props
 * @param {string} [props.projectId] - 项目ID / Project identifier
 * @returns {JSX.Element} t('card.styleTitle')视图 / Style view element
 */
export function StyleView({ projectId }) {
  const { t, locale } = useLocale();
  const requestLanguage = String(locale || '').toLowerCase().startsWith('en') ? 'en' : 'zh';
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [formData, setFormData] = useState({
    style: ''
  });
  const [sampleText, setSampleText] = useState('');
  const styleTextareaRef = React.useRef(null);
  const sampleTextareaRef = React.useRef(null);

  const autoResizeTextarea = React.useMemo(() => {
    return (el) => {
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    };
  }, []);

  const loadStyle = useCallback(async () => {
    setLoading(true);
    try {
      const response = await cardsAPI.getStyle(projectId);
      if (response.data) {
        setFormData(response.data);
      }
    } catch (error) {
      logger.error('Failed to load style:', error);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadStyle();
  }, [loadStyle]);

  useEffect(() => {
    autoResizeTextarea(styleTextareaRef.current);
  }, [autoResizeTextarea, formData.style]);

  useEffect(() => {
    autoResizeTextarea(sampleTextareaRef.current);
  }, [autoResizeTextarea, sampleText]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await cardsAPI.updateStyle(projectId, { style: formData.style || '' });
      alert(t('card.styleUpdated'));
    } catch (error) {
      alert(t('card.styleUpdateFailed').replace('{message}', error.response?.data?.detail || error.message));
    }
  };

  const handleExtract = async () => {
    if (!sampleText.trim()) {
      alert(t('card.styleSampleRequired'));
      return;
    }
    setExtracting(true);
    try {
      const response = await cardsAPI.extractStyle(projectId, { content: sampleText, language: requestLanguage });
      const style = response.data?.style || '';
      setFormData({ style });
      await cardsAPI.updateStyle(projectId, { style });
    } catch (error) {
      alert(t('card.styleExtractFailed').replace('{message}', error.response?.data?.detail || error.message));
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-140px)]">
      <div className="lg:col-span-8 lg:col-start-3 flex flex-col gap-6">
        <Card className="flex-1 flex flex-col overflow-hidden bg-[var(--vscode-bg)] shadow-none">
          <div className="p-6 border-b border-[var(--vscode-sidebar-border)] bg-[var(--vscode-sidebar-bg)] flex flex-row items-center justify-between">
            <h3 className="font-bold text-lg text-[var(--vscode-fg)] flex items-center gap-2">
              <Feather size={18} className="text-[var(--vscode-fg-subtle)]" /> {t('card.styleTitle')}
            </h3>
            <Button variant="ghost" size="sm" onClick={loadStyle} disabled={loading}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-8 custom-scrollbar space-y-8">
            <form id="style-form" onSubmit={handleSubmit} className="space-y-6 max-w-3xl mx-auto">
              <div className="space-y-2">
                <label className="text-xs font-bold text-[var(--vscode-fg-subtle)] uppercase">{t('card.styleLabel')}</label>
                <textarea
                  ref={styleTextareaRef}
                  value={formData.style || ''}
                  onChange={(e) => {
                    setFormData({ style: e.target.value });
                    autoResizeTextarea(e.target);
                  }}
                  className="w-full min-h-[220px] text-sm bg-[var(--vscode-input-bg)] border border-[var(--vscode-input-border)] rounded-[6px] px-3 py-2 text-[var(--vscode-fg)] focus:outline-none focus:border-[var(--vscode-focus-border)] resize-none overflow-hidden"
                  placeholder={t('card.stylePlaceholder')}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-[var(--vscode-fg-subtle)] uppercase">{t('card.styleExtractLabel')}</label>
                  <Button type="button" variant="ghost" size="sm" onClick={handleExtract} disabled={extracting}>
                    <Sparkles size={16} className={extracting ? 'animate-pulse' : ''} />
                    <span className="ml-2">{extracting ? t('card.styleExtracting') : t('card.styleExtractBtn')}</span>
                  </Button>
                </div>
                <textarea
                  ref={sampleTextareaRef}
                  value={sampleText}
                  onChange={(e) => {
                    setSampleText(e.target.value);
                    autoResizeTextarea(e.target);
                  }}
                  className="w-full min-h-[160px] text-sm bg-[var(--vscode-input-bg)] border border-[var(--vscode-input-border)] rounded-[6px] px-3 py-2 text-[var(--vscode-fg)] focus:outline-none focus:border-[var(--vscode-focus-border)] resize-none overflow-hidden"
                  placeholder={t('card.styleSamplePlaceholder')}
                />
              </div>
            </form>
          </div>
          <div className="p-4 border-t border-[var(--vscode-sidebar-border)] bg-[var(--vscode-sidebar-bg)] flex justify-end">
            <Button form="style-form" type="submit" disabled={loading} className="w-full md:w-auto">
              <Save size={16} className="mr-2" /> {t('card.saveStyle')}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
