/**
 * 文枢 WenShape - 深度上下文感知的智能体小说创作系统
 * WenShape - Deep Context-Aware Agent-Based Novel Writing System
 *
 * Copyright © 2025-2026 WenShape Team
 * License: PolyForm Noncommercial License 1.0.0
 *
 * 模块说明 / Module Description:
 *   世界观卡片视图 - 展示世界观设定列表和编辑表单，支持地点、组织、物品等
 *   Worldview component for displaying world-building cards with CRUD operations.
 */

import React, { useCallback, useState, useEffect } from 'react';
import { cardsAPI } from '../../api';
import { Card, Button, Input } from '../ui/core';
import { Plus, Globe, X, Save } from 'lucide-react';
import { useLocale } from '../../i18n';

/**
 * 星级规范化函数 / Star rating normalization
 * @param {*} value - 要规范化的值 / Value to normalize
 * @returns {number} 规范化后的星级 / Normalized rating
 */
const normalizeStars = (value) => {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) return 1;
  return Math.max(1, Math.min(parsed, 3));
};

/**
 * 格式化别名函数 / Format aliases string
 * @param {*} value - 别名值 / Aliases value
 * @returns {string} 格式化字符串 / Formatted string
 */
const formatAliases = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean).join('，');
  return value || '';
};

/**
 * 解析列表输入函数 / Parse comma/newline-separated list
 * @param {string} value - 列表文本 / List text
 * @returns {Array} 解析后的数组 / Parsed array
 */
const parseListInput = (value) => {
  return String(value || '')
    .split(/[,，;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
};

/**
 * 世界观卡片视图组件 - 展示和编辑世界观设定
 *
 * Component for displaying and editing worldview cards (locations, organizations, items).
 * Provides CRUD interface with support for multiple worldview categories.
 *
 * @component
 * @example
 * return (
 *   <WorldView
 *     worlds={[{ id: 'w001', name: '东京', type: 'location' }]}
 *     onEdit={handleEdit}
 *     onSave={handleSave}
 *     projectId="proj-001"
 *   />
 * )
 *
 * @param {Object} props - Component props
 * @param {Array} [props.worlds=[]] - 世界观卡片列表 / Worldview cards
 * @param {Function} [props.onEdit] - 编辑回调 / Edit callback
 * @param {Function} [props.onSave] - 保存回调 / Save callback
 * @param {string} [props.projectId] - 项目ID / Project identifier
 * @param {string|null} [props.editing=null] - 编辑中的卡片ID / Card ID being edited
 * @param {Object|null} [props.editingWorld=null] - 编辑中的卡片数据 / Card data being edited
 * @param {Function} [props.onCancel] - 取消编辑回调 / Cancel edit callback
 * @returns {JSX.Element} 世界观卡片视图 / Worldview view element
 */
/**
 * WorldView - 世界设定视图
 * 负责设定卡列表与编辑表单展示。
 */
export function WorldView({ projectId }) {
  const { t } = useLocale();
  const [cards, setCards] = useState([]);
  const [editing, setEditing] = useState(null);
  const sortedCards = React.useMemo(() => {
    const list = Array.isArray(cards) ? cards.slice() : [];
    list.sort((a, b) => {
      const starDiff = normalizeStars(b?.stars) - normalizeStars(a?.stars);
      if (starDiff !== 0) return starDiff;
      return String(a?.name || '').localeCompare(String(b?.name || ''), undefined, { numeric: true, sensitivity: 'base' });
    });
    return list;
  }, [cards]);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    aliases: '',
    category: '',
    stars: 1
  });
  const [loading, setLoading] = useState(false);

  const loadCards = useCallback(async () => {
    setLoading(true);
    try {
      const response = await cardsAPI.listWorldIndex(projectId);
      const loaded = Array.isArray(response.data) ? response.data : [];
      setCards(loaded);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  const startEdit = (card = {}) => {
    setEditing(card);
    setFormData({
      name: card.name || '',
      description: card.description || '',
      aliases: formatAliases(card.aliases),
      category: card.category || '',
      stars: normalizeStars(card.stars)
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    const aliases = parseListInput(formData.aliases);
    const payload = {
      name: formData.name.trim(),
      description: (formData.description || '').trim(),
      aliases,
      category: (formData.category || '').trim(),
      stars: normalizeStars(formData.stars)
    };

    if (editing?.name) {
      await cardsAPI.updateWorld(projectId, editing.name, payload);
    } else {
      await cardsAPI.createWorld(projectId, payload);
    }

    setEditing(null);
    setFormData({
      name: '',
      description: '',
      aliases: '',
      category: '',
      stars: 1
    });
    await loadCards();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-140px)]">
      <div className="lg:col-span-4 flex flex-col gap-4 overflow-hidden">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold text-[var(--vscode-fg)]">{t('card.worldSectionTitle')}</h3>
          <Button size="sm" onClick={() => startEdit({})}>
            <Plus size={16} className="mr-2" /> {t('common.new')}
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-3 pr-2">
          {sortedCards.map((card) => (
            <div
              key={card.name}
              onClick={() => startEdit(card)}
              className={`p-4 rounded-[6px] border cursor-pointer transition-colors ${
                editing?.name === card.name
                  ? 'bg-[var(--vscode-list-active)] text-[var(--vscode-list-active-fg)] border-[var(--vscode-input-border)]'
                  : 'bg-[var(--vscode-bg)] border-[var(--vscode-sidebar-border)] text-[var(--vscode-fg-subtle)] hover:bg-[var(--vscode-list-hover)] hover:text-[var(--vscode-fg)]'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold font-serif text-lg">{card.name}</span>
                <div className="flex items-center gap-2 text-[10px] opacity-80">
                  <span>{t('card.starsLabel').replace('{count}', normalizeStars(card.stars))}</span>
                  <Globe size={14} className="opacity-70" />
                </div>
              </div>
              <div className={`text-xs opacity-90 line-clamp-2 ${editing?.name === card.name ? 'text-[var(--vscode-list-active-fg)]' : 'text-[var(--vscode-fg-subtle)]'}`}>
                {card.description || t('card.noDesc')}
              </div>
            </div>
          ))}
          {!loading && cards.length === 0 && (
            <div className="text-xs text-[var(--vscode-fg-subtle)]">{t('card.emptyWorld')}</div>
          )}
        </div>
      </div>

      <Card className="lg:col-span-8 bg-[var(--vscode-bg)] border border-[var(--vscode-sidebar-border)] rounded-[6px] overflow-hidden flex flex-col shadow-none">
        {editing ? (
          <div className="flex-1 flex flex-col">
            <div className="flex flex-row items-center justify-between p-6 border-b border-[var(--vscode-sidebar-border)] bg-[var(--vscode-sidebar-bg)]">
              <h3 className="font-bold text-lg text-[var(--vscode-fg)] flex items-center gap-2">
                <Globe className="text-[var(--vscode-fg-subtle)]" size={18} />
                {editing.name ? t('card.editTitle').replace('{name}', editing.name) : t('card.newWorld')}
              </h3>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                  <X size={16} />
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-8">
              <form id="world-form" onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[var(--vscode-fg-subtle)] uppercase">{t('card.fieldName')}</label>
                  <Input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder={t('card.worldNamePlaceholder')}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-[var(--vscode-fg-subtle)] uppercase">{t('card.fieldStars')}</label>
                  <select
                    value={formData.stars}
                    onChange={(e) => setFormData({ ...formData, stars: normalizeStars(e.target.value) })}
                    className="w-full h-10 px-3 rounded-[6px] border border-[var(--vscode-input-border)] bg-[var(--vscode-input-bg)] text-sm text-[var(--vscode-fg)] focus-visible:outline-none focus-visible:border-[var(--vscode-focus-border)] transition-colors"
                  >
                    <option value={3}>{t('card.stars3')}</option>
                    <option value={2}>{t('card.stars2')}</option>
                    <option value={1}>{t('card.stars1')}</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-[var(--vscode-fg-subtle)] uppercase">{t('card.fieldAliases')}</label>
                  <Input
                    type="text"
                    value={formData.aliases || ''}
                    onChange={(e) => setFormData({ ...formData, aliases: e.target.value })}
                    placeholder={t('card.aliasesPlaceholder')}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-[var(--vscode-fg-subtle)] uppercase">{t('card.fieldCategory')}</label>
                  <Input
                    type="text"
                    value={formData.category || ''}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    placeholder={t('card.categoryPlaceholder')}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-[var(--vscode-fg-subtle)] uppercase">{t('card.fieldDescription')}</label>
                  <textarea
                    className="flex min-h-[200px] w-full rounded-[6px] border border-[var(--vscode-input-border)] bg-[var(--vscode-input-bg)] px-3 py-2 text-sm text-[var(--vscode-fg)] placeholder:text-[var(--vscode-fg-subtle)] focus-visible:outline-none focus-visible:border-[var(--vscode-focus-border)] transition-colors"
                    value={formData.description || ''}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder={t('card.worldDescPlaceholder')}
                  />
                </div>
              </form>
            </div>
            <div className="p-4 border-t border-[var(--vscode-sidebar-border)] bg-[var(--vscode-sidebar-bg)] flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
              <Button form="world-form" type="submit">
                <Save size={16} className="mr-2" /> {t('card.saveWorld')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-[var(--vscode-fg-subtle)]">
            <Globe size={64} className="mb-4 opacity-20" />
            <div className="font-serif text-lg">{t('card.selectWorldHint')}</div>
          </div>
        )}
      </Card>
    </div>
  );
}
