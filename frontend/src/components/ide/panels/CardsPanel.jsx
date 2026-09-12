/**
 * 文枢 WenShape - 深度上下文感知的智能体小说创作系统
 * WenShape - Deep Context-Aware Agent-Based Novel Writing System
 *
 * Copyright © 2025-2026 WenShape Team
 * License: PolyForm Noncommercial License 1.0.0
 *
 * 模块说明 / Module Description:
 *   卡片面板 - 管理角色卡、世界观卡、风格卡，支持创建、编辑、删除和星级管理
 *   Cards panel for managing character, worldview, and style cards with CRUD operations.
 */

/**
 * 设定卡片管理面板 - 角色、世界观和风格卡片的集中管理界面
 *
 * IDE panel for managing story setting cards (characters, worldview, style).
 * Provides CRUD operations, filtering, and integration with wiki import and card editing dialogs.
 * Maintains visual consistency without altering core business logic.
 *
 * @component
 * @example
 * return (
 *   <CardsPanel />
 * )
 *
 * @returns {JSX.Element} 卡片面板 / Cards panel element
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useIDE } from '../../../context/IDEContext';
import { useParams } from 'react-router-dom';
import { cardsAPI } from '../../../api';
import {
  Plus, RefreshCw, User, Globe, Trash2, FileText, ChevronDown, ChevronRight, Network, X, Folder, FolderPlus, Pencil,
} from 'lucide-react';
import {
  assignCard,
  cardKeyOf,
  createFolder,
  deleteFolder,
  emptyFolderState,
  groupCards,
  loadFolderState,
  renameFolder,
  saveFolderState,
} from '../../../lib/cardFolders';
import { cn } from '../../ui/core';
import logger from '../../../utils/logger';
import { useLocale } from '../../../i18n';
import { SidebarPanelHeader } from '../SidebarPanelHeader';

// 画布依赖较重（React Flow）：懒加载为独立 chunk，不打开关系图时主包零成本。
const RelationGraphView = lazy(() => import('../../project/RelationGraphView'));

const normalizeStars = (value) => {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) return 1;
  return Math.max(1, Math.min(parsed, 3));
};

const compareByStarsThenName = (a, b) => {
  const starDiff = normalizeStars(b?.stars) - normalizeStars(a?.stars);
  if (starDiff !== 0) return starDiff;
  return String(a?.name || '').localeCompare(String(b?.name || ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
};

export default function CardsPanel() {
  const { t, locale } = useLocale();
  const requestLanguage = String(locale || '')
    .toLowerCase()
    .startsWith('en')
    ? 'en'
    : 'zh';
  const { projectId } = useParams();
  const { state, dispatch, registerSaveTarget } = useIDE();
  const [entities, setEntities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState('character');

  const [styleCard, setStyleCard] = useState({ style: '' });
  const [styleExpanded, setStyleExpanded] = useState(true);
  const [styleSample, setStyleSample] = useState('');
  const [styleEditing, setStyleEditing] = useState(false);
  const styleRef = useRef('');
  const styleDirtyRef = useRef(false);
  const styleSavingRef = useRef(false);

  // 卡片文件夹：纯前端视图状态，按项目存 localStorage，不影响后端卡片数据。
  const [folderState, setFolderState] = useState(emptyFolderState);
  const [collapsedFolders, setCollapsedFolders] = useState({});
  const [dragOverFolder, setDragOverFolder] = useState(null);

  useEffect(() => {
    setFolderState(loadFolderState(projectId));
  }, [projectId]);

  const commitFolderState = useCallback(
    (next) => {
      setFolderState(next);
      saveFolderState(projectId, next);
    },
    [projectId],
  );

  const handleCreateFolder = () => {
    const name = window.prompt(t('panels.cards.folderNamePrompt'));
    if (name && name.trim()) commitFolderState(createFolder(folderState, name));
  };

  const handleRenameFolder = (folder) => {
    const name = window.prompt(t('panels.cards.folderNamePrompt'), folder.name);
    if (name && name.trim()) commitFolderState(renameFolder(folderState, folder.id, name));
  };

  const handleDeleteFolder = (folder) => {
    // 只删分组，卡片回到「未分组」——文案必须说清，否则作者会以为卡片被删。
    if (!window.confirm(t('panels.cards.folderDeleteConfirm').replace('{name}', folder.name))) return;
    commitFolderState(deleteFolder(folderState, folder.id));
  };

  const handleDropOnFolder = (cardKey, folderId) => {
    setDragOverFolder(null);
    if (cardKey) commitFolderState(assignCard(folderState, cardKey, folderId));
  };

  const [styleExtracting, setStyleExtracting] = useState(false);
  const [relationGraphOpen, setRelationGraphOpen] = useState(false);

  const loadEntities = useCallback(async () => {
    setLoading(true);
    try {
      const [charsResp, worldsResp, styleResp] = await Promise.allSettled([
        cardsAPI.listCharactersIndex(projectId),
        cardsAPI.listWorldIndex(projectId),
        cardsAPI.getStyle(projectId),
      ]);

      const chars =
        charsResp.status === 'fulfilled' ? (Array.isArray(charsResp.value.data) ? charsResp.value.data : []) : [];
      const worlds =
        worldsResp.status === 'fulfilled' ? (Array.isArray(worldsResp.value.data) ? worldsResp.value.data : []) : [];
      const style = styleResp.status === 'fulfilled' ? styleResp.value.data : null;

      const combined = [
        ...chars
          .filter((card) => card?.name)
          .map((card) => ({
            id: `character:${card.name}`,
            name: card.name,
            type: 'character',
            stars: normalizeStars(card.stars),
          })),
        ...worlds
          .filter((card) => card?.name)
          .map((card) => ({
            id: `world:${card.name}`,
            name: card.name,
            type: 'world',
            stars: normalizeStars(card.stars),
          })),
      ];

      setEntities(combined);
      if (!styleDirtyRef.current && !styleSavingRef.current) {
        const nextStyle = style || { style: '' };
        setStyleCard(nextStyle);
        styleRef.current = nextStyle.style || '';
      }
    } catch (e) {
      logger.error('Failed to load cards', e);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadEntities();
  }, [loadEntities, state.lastSavedAt]);

  const handleCreateCard = () => {
    if (typeFilter === 'style') return;
    const newCard = { name: '', type: typeFilter, isNew: true };
    dispatch({
      type: 'SET_ACTIVE_DOCUMENT',
      payload: { type: typeFilter, id: '', data: newCard, isNew: true },
    });
  };

  const handleDeleteCard = async (entity, e) => {
    e.stopPropagation();
    if (!confirm(t('panels.cards.deleteConfirm').replace('{name}', entity.name))) return;

    try {
      if (entity.type === 'character') {
        await cardsAPI.deleteCharacter(projectId, entity.name);
      } else if (entity.type === 'world') {
        await cardsAPI.deleteWorld(projectId, entity.name);
      }

      await loadEntities();

      // 卡片已删除：关闭对应标签（若正打开则自动接管到相邻标签）。
      dispatch({ type: 'CLOSE_TAB', payload: `${entity.type}:${entity.name}` });
    } catch (error) {
      logger.error('Failed to delete card:', error);
      alert(t('panels.cards.deleteFailed').replace('{message}', error.response?.data?.detail || error.message));
    }
  };

  const handleSaveStyle = useCallback(async () => {
    if (!styleDirtyRef.current) return true;
    if (styleSavingRef.current) return false;
    const snapshot = styleRef.current;
    styleSavingRef.current = true;
    try {
      await cardsAPI.updateStyle(projectId, { style: snapshot });
      if (styleRef.current === snapshot) styleDirtyRef.current = false;
      return true;
    } catch (error) {
      logger.error('Failed to save style card:', error);
      alert(t('card.styleUpdateFailed').replace('{message}', error.response?.data?.detail || error.message));
      return false;
    } finally {
      styleSavingRef.current = false;
    }
  }, [projectId, t]);

  useEffect(
    () =>
      registerSaveTarget('style', {
        label: t('panels.cards.style'),
        isDirty: () => styleDirtyRef.current,
        save: handleSaveStyle,
      }),
    [handleSaveStyle, registerSaveTarget, t],
  );

  const handleExtractStyle = async () => {
    if (!styleSample.trim()) {
      alert(t('panels.cards.styleSampleRequired'));
      return;
    }
    setStyleExtracting(true);
    try {
      const resp = await cardsAPI.extractStyle(projectId, { content: styleSample, language: requestLanguage });
      const style = String(resp.data?.style || '').trim();
      // 空结果绝不写回：否则一次失败的提炼会把作者既有的文风卡清空。
      if (!style) {
        alert(t('panels.cards.extractFailed').replace('{message}', 'style_extraction_empty'));
        return;
      }
      setStyleCard({ style });
      styleRef.current = style;
      await cardsAPI.updateStyle(projectId, { style });
      styleDirtyRef.current = false;
    } catch (error) {
      alert(t('panels.cards.extractFailed').replace('{message}', error.response?.data?.detail || error.message));
    } finally {
      setStyleExtracting(false);
    }
  };

  const filteredEntities = useMemo(() => {
    return entities
      .filter((entity) => entity.type === typeFilter)
      .slice()
      .sort(compareByStarsThenName);
  }, [entities, typeFilter]);

  // 必须定义在 filteredEntities 之后：const 有 TDZ，提前引用会在渲染时直接抛
  // ReferenceError（lint / build / 纯函数单测都抓不到组件体内的这类顺序错误）。
  const groupedCards = useMemo(() => groupCards(filteredEntities, folderState), [filteredEntities, folderState]);

  const getCardIcon = (type) => {
    switch (type) {
      case 'character':
        return <User size={14} className="text-[var(--vscode-fg-subtle)]" />;
      case 'world':
        return <Globe size={14} className="text-[var(--vscode-fg-subtle)]" />;
      case 'style':
        return <FileText size={14} className="text-[var(--vscode-fg-subtle)]" />;
      default:
        return <FileText size={14} className="text-[var(--vscode-fg-subtle)]" />;
    }
  };

  const typeOptions = [
    { id: 'character', label: t('panels.cards.character'), icon: User },
    { id: 'world', label: t('panels.cards.world'), icon: Globe },
    { id: 'style', label: t('panels.cards.style'), icon: FileText },
  ];

  return (
    <div className="anti-theme h-full flex flex-col bg-[var(--vscode-bg)] text-[var(--vscode-fg)]">
      <div>
        <SidebarPanelHeader
          title={t('panels.cards.libraryTitle')}
          actions={
            <>
            <button
              onClick={() => setRelationGraphOpen(true)}
              className="p-1 hover:bg-[var(--vscode-list-hover)] rounded-[4px]"
              title={t('relationGraph.open')}
            >
              <Network size={12} />
            </button>
            <button
              onClick={loadEntities}
              className="p-1 hover:bg-[var(--vscode-list-hover)] rounded-[4px]"
              title={t('common.refresh')}
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            </button>
            {typeFilter !== 'style' && (
              <button
                onClick={handleCreateFolder}
                className="p-1 hover:bg-[var(--vscode-list-hover)] rounded-[4px]"
                title={t('panels.cards.folderNew')}
              >
                <FolderPlus size={12} />
              </button>
            )}
            {typeFilter !== 'style' && (
              <button
                onClick={handleCreateCard}
                className="p-1 hover:bg-[var(--vscode-list-hover)] rounded-[4px]"
                title={t('common.new')}
              >
                <Plus size={12} />
              </button>
            )}
            </>
          }
        />

        <div className="px-3 pb-2">
          <div className="bg-[var(--vscode-bg)] rounded-[6px] p-0.5 border border-[var(--vscode-sidebar-border)]">
            <div className="flex">
              {typeOptions.map((opt) => {
                const Icon = opt.icon;
                const isActive = typeFilter === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => setTypeFilter(opt.id)}
                    className={cn(
                      'flex-1 py-1 px-2 text-[10px] font-medium rounded-[4px] transition-none',
                      isActive
                        ? 'bg-[var(--vscode-list-active)] text-[var(--vscode-list-active-fg)]'
                        : 'text-[var(--vscode-fg-subtle)] hover:bg-[var(--vscode-list-hover)] hover:text-[var(--vscode-fg)]',
                    )}
                  >
                    <div className="flex items-center justify-center gap-1">
                      <Icon size={10} className={isActive ? 'opacity-90' : 'opacity-60'} />
                      <span>{opt.label}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {typeFilter === 'style' && (
          <div className="space-y-2">
            <div
              onClick={() => setStyleExpanded(!styleExpanded)}
              className="flex items-center gap-2 p-2 rounded-[6px] cursor-pointer hover:bg-[var(--vscode-list-hover)] transition-none"
            >
              {styleExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <FileText size={14} className="text-[var(--vscode-fg-subtle)]" />
              <span className="text-sm font-medium flex-1">{t('panels.cards.styleSetting')}</span>
            </div>

            {styleExpanded && (
              <div className="space-y-3 pb-4 pl-6 pr-2">
                {/* 当前文风：默认只读展示（长文本可读性远好于裸 textarea），点「编辑」才可改。 */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <label className="ui-caption font-medium text-[var(--vscode-fg-subtle)]">
                      {t('panels.cards.style')}
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-[var(--vscode-fg-subtle)]">
                        {(styleCard.style || '').length}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (styleEditing) handleSaveStyle();
                          setStyleEditing((value) => !value);
                        }}
                        className="rounded-[4px] border border-[var(--vscode-input-border)] px-2 py-0.5 text-[10px] text-[var(--vscode-fg)] transition-colors hover:bg-[var(--vscode-list-hover)]"
                      >
                        {styleEditing ? t('panels.cards.styleDone') : t('panels.cards.styleEdit')}
                      </button>
                    </div>
                  </div>

                  {styleEditing || !(styleCard.style || '').trim() ? (
                    <textarea
                      value={styleCard.style || ''}
                      onChange={(e) => {
                        const style = e.target.value;
                        styleRef.current = style;
                        styleDirtyRef.current = true;
                        setStyleCard((prev) => ({ ...prev, style }));
                      }}
                      onBlur={handleSaveStyle}
                      className="min-h-[160px] w-full resize-y rounded-[6px] border border-[var(--vscode-input-border)] bg-[var(--vscode-input-bg)] p-2 text-xs leading-relaxed text-[var(--vscode-fg)] focus:border-[var(--vscode-focus-border)] focus:ring-1 focus:ring-[var(--vscode-focus-border)]"
                      placeholder={t('card.stylePlaceholder')}
                    />
                  ) : (
                    <div className="custom-scrollbar max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-[6px] border border-[var(--vscode-sidebar-border)] bg-[var(--vscode-input-bg)] p-2 text-xs leading-relaxed text-[var(--vscode-fg)]">
                      {styleCard.style}
                    </div>
                  )}
                </div>

                {/* 从范文提炼 */}
                <div className="space-y-1 rounded-[6px] border border-[var(--vscode-sidebar-border)] p-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="ui-caption font-medium text-[var(--vscode-fg-subtle)]">
                      {t('card.styleExtractLabel')}
                    </label>
                    <span className="font-mono text-[10px] text-[var(--vscode-fg-subtle)]">
                      {styleSample.length}
                    </span>
                  </div>
                  <textarea
                    value={styleSample}
                    onChange={(e) => setStyleSample(e.target.value)}
                    className="min-h-[90px] w-full resize-y rounded-[6px] border border-[var(--vscode-input-border)] bg-[var(--vscode-input-bg)] p-2 text-xs text-[var(--vscode-fg)] focus:border-[var(--vscode-focus-border)] focus:ring-1 focus:ring-[var(--vscode-focus-border)]"
                    placeholder={t('card.styleSamplePlaceholder')}
                  />
                  <div className="flex items-center justify-between gap-2 pt-0.5">
                    <span className="text-[10px] text-[var(--vscode-fg-subtle)]">
                      {t('panels.cards.styleExtractHint')}
                    </span>
                    <button
                      type="button"
                      onClick={handleExtractStyle}
                      disabled={styleExtracting || !styleSample.trim()}
                      className="shrink-0 rounded-[4px] border border-[var(--vscode-input-border)] bg-[var(--vscode-list-active)] px-2 py-1 text-[10px] text-[var(--vscode-list-active-fg)] transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {styleExtracting ? t('card.styleExtracting') : t('panels.cards.styleExtractOverwrite')}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {typeFilter !== 'style' && (
          <>
            {filteredEntities.length === 0 && !loading && (
              <div className="text-center text-xs text-[var(--vscode-fg-subtle)] py-8">
                <p>
                  {t('panels.cards.noCardsType').replace(
                    '{type}',
                    typeOptions.find((opt) => opt.id === typeFilter)?.label || '',
                  )}
                </p>
                <p className="text-[10px] mt-2 opacity-60">{t('panels.cards.createHint')}</p>
              </div>
            )}

            {/* 文件夹分组：纯前端视图状态（lib/cardFolders.js），拖拽卡片到文件夹标题即可归拢。 */}
            <div className="space-y-2">
              {groupedCards.map((group) => {
                const folderId = group.folder?.id || '';
                const collapsed = folderId ? collapsedFolders[folderId] : false;
                const isDropTarget = dragOverFolder === (folderId || '__ungrouped__');
                return (
                  <div
                    key={folderId || '__ungrouped__'}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverFolder(folderId || '__ungrouped__');
                    }}
                    onDragLeave={() => setDragOverFolder(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleDropOnFolder(e.dataTransfer.getData('text/plain'), folderId);
                    }}
                    className={cn(
                      'rounded-[6px] border border-transparent',
                      isDropTarget && 'border-[var(--vscode-focus-border)] bg-[var(--vscode-list-hover)]',
                    )}
                  >
                    {group.folder ? (
                      <div className="group/folder flex items-center gap-1 px-1 py-1">
                        <button
                          type="button"
                          onClick={() =>
                            setCollapsedFolders((prev) => ({ ...prev, [folderId]: !prev[folderId] }))
                          }
                          className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs text-[var(--vscode-fg)]"
                        >
                          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                          <Folder size={12} className="shrink-0 text-[var(--vscode-fg-subtle)]" />
                          <span className="truncate font-medium">{group.folder.name}</span>
                          <span className="shrink-0 font-mono text-[10px] text-[var(--vscode-fg-subtle)]">
                            {group.cards.length}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRenameFolder(group.folder)}
                          title={t('common.edit')}
                          className="p-1 text-[var(--vscode-fg-subtle)] opacity-0 transition-opacity hover:text-[var(--vscode-fg)] group-hover/folder:opacity-100"
                        >
                          <Pencil size={11} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteFolder(group.folder)}
                          title={t('common.delete')}
                          className="p-1 text-[var(--vscode-fg-subtle)] opacity-0 transition-opacity hover:text-red-500 group-hover/folder:opacity-100"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ) : groupedCards.length > 1 ? (
                      <div className="px-2 py-1 text-[10px] text-[var(--vscode-fg-subtle)]">
                        {t('panels.cards.folderUngrouped')}
                      </div>
                    ) : null}

                    {collapsed ? null : (
                      <div className={cn('space-y-1', group.folder && 'pl-4')}>
                        {group.cards.map((entity, idx) => (
                          <div
                            key={entity.id || entity.name || idx}
                            draggable
                            onDragStart={(e) => e.dataTransfer.setData('text/plain', cardKeyOf(entity))}
                            onClick={() =>
                              dispatch({
                                type: 'SET_ACTIVE_DOCUMENT',
                                payload: { type: entity.type || 'card', id: entity.name, data: entity },
                              })
                            }
                            className={cn(
                              'flex items-start gap-2 px-2 py-2 rounded-[6px] cursor-pointer hover:bg-[var(--vscode-list-hover)] group border border-transparent transition-none',
                              state.activeDocument?.id === entity.name &&
                                state.activeDocument?.type === (entity.type || 'card')
                                ? 'bg-[var(--vscode-list-active)] text-[var(--vscode-list-active-fg)]'
                                : '',
                            )}
                          >
                            <div className="mt-0.5 opacity-60">{getCardIcon(entity.type)}</div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-sm font-medium leading-none mb-1">{entity.name}</div>
                                <div className="text-[10px] opacity-70">{`${normalizeStars(entity.stars)}${t('panels.cards.starSuffix')}`}</div>
                              </div>
                            </div>
                            <button
                              onClick={(e) => handleDeleteCard(entity, e)}
                              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-50 rounded-[4px] text-[var(--vscode-fg-subtle)] hover:text-red-500 transition-none"
                              title={t('common.delete')}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {relationGraphOpen &&
        createPortal(
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6">
            <div className="anti-theme flex h-[80vh] w-full max-w-6xl flex-col overflow-hidden rounded-[10px] border border-[var(--vscode-sidebar-border)] bg-[var(--vscode-bg)] text-[var(--vscode-fg)] shadow-xl">
              <div className="flex items-center justify-between border-b border-[var(--vscode-sidebar-border)] px-4 py-2">
                <div className="flex items-center gap-2">
                  <Network size={14} className="text-[var(--vscode-fg-subtle)]" />
                  <span className="text-sm font-medium">{t('relationGraph.title')}</span>
                </div>
                <button
                  onClick={() => setRelationGraphOpen(false)}
                  className="p-1 hover:bg-[var(--vscode-list-hover)] rounded-[4px]"
                  title={t('common.close')}
                >
                  <X size={14} />
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center text-xs text-[var(--vscode-fg-subtle)]">
                      {t('relationGraph.loading')}
                    </div>
                  }
                >
                  <RelationGraphView projectId={projectId} />
                </Suspense>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
