/**
 * 文枢 WenShape - 深度上下文感知的智能体小说创作系统
 * WenShape - Deep Context-Aware Agent-Based Novel Writing System
 *
 * Copyright © 2025-2026 WenShape Team
 * License: PolyForm Noncommercial License 1.0.0
 *
 * 模块说明 / Module Description:
 *   差异审阅视图 - 展示统一格式的文本修改差异，支持逐块接受/拒绝
 *   Diff review view for displaying unified diff format and per-hunk accept/reject.
 */

/**
 * 差异审阅视图组件 - 展示编辑修改的统一差异视图
 *
 * Displays unified diff format with inline segments (context/add/delete) and supports
 * per-hunk accept/reject decisions. Shows overall diff statistics.
 *
 * @component
 * @example
 * return (
 *   <DiffReviewView
 *     ops={diffOps}
 *     hunks={diffHunks}
 *     stats={{ additions: 10, deletions: 5 }}
 *     onAcceptHunk={handleAccept}
 *     onRejectHunk={handleReject}
 *   />
 * )
 *
 * @param {Object} props - Component props
 * @param {Array} [props.ops=[]] - buildLineDiff 返回的操作 / Line diff operations
 * @param {Array} [props.hunks=[]] - 后端返回的 diff 块 / Backend diff chunks
 * @param {Object} [props.stats={}] - 统计信息 / Statistics { additions, deletions }
 * @param {Object} [props.decisions={}] - 块决策映射 / Hunk decision map { [hunkId]: 'accepted'|'rejected' }
 * @param {Function} [props.onAcceptHunk] - 接受块回调 / Accept hunk callback
 * @param {Function} [props.onRejectHunk] - 拒绝块回调 / Reject hunk callback
 * @param {string} [props.originalVersion='v1'] - 原始版本标签 / Original version label
 * @param {string} [props.revisedVersion='v2'] - 修订版本标签 / Revised version label
 * @returns {JSX.Element} 差异审阅视图 / Diff review view element
 */

import React, { useMemo } from 'react';
import { cn } from '../ui/core';
import { Plus, Minus, FileText, Check, X } from 'lucide-react';
import { useLocale } from '../../i18n';

const renderLine = (line) => (line === '' ? '\u00A0' : line);

const DiffReviewView = ({
  ops = [], // buildLineDiff 返回的 ops（含 context/add/delete；非 context 通常带 hunkId）
  hunks = [], // 后端 diff 块
  stats = {}, // { additions: N, deletions: N }
  decisions = {}, // { [hunkId]: 'accepted' | 'rejected' }
  onAcceptHunk, // 接受单块
  onRejectHunk, // 拒绝单块
  originalVersion = 'v1',
  revisedVersion = 'v2',
}) => {
  const { t } = useLocale();
  const segments = useMemo(() => buildInlineSegments(ops), [ops]);
  const hasChanges = (hunks?.length || 0) > 0 || segments.some((segment) => segment.type === 'change');

  if (!hasChanges) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-[var(--vscode-fg-subtle)]">
        <FileText size={48} className="mb-4 opacity-50" />
        <p className="text-sm">{t('diff.noChanges')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[var(--vscode-bg)] rounded-[6px] border border-[var(--vscode-sidebar-border)] overflow-hidden">
      {/* 头部统计 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--vscode-sidebar-border)] bg-[var(--vscode-sidebar-bg)]">
        <div className="flex items-center gap-4">
          <span className="text-xs font-bold text-[var(--vscode-fg)]">{t('diff.previewTitle')}</span>
          <div className="flex items-center gap-3 text-[10px]">
            <span className="flex items-center gap-1 text-green-600">
              <Plus size={12} />
              <span className="font-mono">
                {stats.additions || 0} {t('diff.added')}
              </span>
            </span>
            <span className="flex items-center gap-1 text-red-500">
              <Minus size={12} />
              <span className="font-mono">
                {stats.deletions || 0} {t('diff.deleted')}
              </span>
            </span>
          </div>
          <span className="text-[10px] text-[var(--vscode-fg-subtle)] font-mono">
            {originalVersion} → {revisedVersion}
          </span>
        </div>
      </div>

      {/* 内容区：在全文对应位置展示内联差异 */}
      <div className="flex-1 overflow-y-scroll editor-scrollbar px-[clamp(16px,3.5vw,56px)] py-5">
        <div className="font-serif text-[length:var(--editor-font-size,16px)] leading-relaxed text-[var(--vscode-fg)] space-y-0.5">
          {segments.map((segment, index) => {
            if (segment.type === 'context') {
              return (
                <div key={`ctx-${index}`} className="leading-loose whitespace-pre-wrap break-words">
                  {renderLine(segment.content)}
                </div>
              );
            }

            const decision = decisions[segment.hunkId];
            return (
              <InlineChangeBlock
                key={`chg-${segment.hunkId}-${index}`}
                decision={decision}
                onAccept={() => onAcceptHunk?.(segment.hunkId)}
                onReject={() => onRejectHunk?.(segment.hunkId)}
                deletedLines={segment.deletedLines}
                addedLines={segment.addedLines}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

/**
 * 单层变更块（对齐主流编程 IDE）：删除行红底、新增行绿底，各自左侧一条色条；
 * 右上角一对勾/叉即为全部操作。
 *
 * U9：此前每块是「卡片边框 + 头部栏 + 状态药丸 + 两个文字按钮 + 内层圆角块」的多层结构，
 * 正文被层层包裹，长 diff 极难扫读（负责人反馈：不用差异块层层显示）。
 * 现在只保留一层色块，决策状态用勾/叉的实心态与整块淡出表达，不再占用垂直空间。
 */
const InlineChangeBlock = ({ decision, onAccept, onReject, deletedLines = [], addedLines = [] }) => {
  const { t } = useLocale();
  const accepted = decision === 'accepted';
  const rejected = decision === 'rejected';

  return (
    <div className="group relative my-1">
      {deletedLines.length > 0 ? (
        <div
          className={cn(
            'border-l-[3px] border-red-400 bg-red-50/70 py-0.5 pl-2 pr-16',
            accepted && 'opacity-40',
          )}
        >
          {deletedLines.map((line, idx) => (
            <div
              key={`del-${idx}`}
              className="whitespace-pre-wrap break-words leading-loose text-red-800 line-through decoration-red-400"
            >
              {renderLine(line)}
            </div>
          ))}
        </div>
      ) : null}
      {addedLines.length > 0 ? (
        <div
          className={cn(
            'border-l-[3px] border-green-500 bg-green-50/70 py-0.5 pl-2 pr-16',
            rejected && 'opacity-40 line-through decoration-green-500',
          )}
        >
          {addedLines.map((line, idx) => (
            <div key={`add-${idx}`} className="whitespace-pre-wrap break-words leading-loose text-green-900">
              {renderLine(line)}
            </div>
          ))}
        </div>
      ) : null}

      {/* 勾/叉：低存在感常驻，悬停增强；已决策的一侧保持实心，便于扫读当前状态。 */}
      <div className="absolute right-1 top-1 flex gap-1 opacity-50 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          title={t('diff.reject')}
          onClick={onReject}
          className={cn(
            'rounded-[4px] p-1 transition-colors',
            rejected
              ? 'bg-red-600 text-white'
              : 'bg-[var(--vscode-input-bg)] text-red-600 hover:bg-red-100',
          )}
        >
          <X size={12} />
        </button>
        <button
          type="button"
          title={t('diff.accept')}
          onClick={onAccept}
          className={cn(
            'rounded-[4px] p-1 transition-colors',
            accepted
              ? 'bg-green-600 text-white'
              : 'bg-[var(--vscode-input-bg)] text-green-700 hover:bg-green-100',
          )}
        >
          <Check size={12} />
        </button>
      </div>
    </div>
  );
};

const buildInlineSegments = (ops = []) => {
  const segments = [];

  let index = 0;
  while (index < ops.length) {
    const op = ops[index];
    if (op.type === 'context') {
      segments.push({ type: 'context', content: op.content });
      index += 1;
      continue;
    }

    if (op.type !== 'add' && op.type !== 'delete') {
      index += 1;
      continue;
    }

    const hunkId = op.hunkId || `hunk-unknown-${index}`;
    const deletedLines = [];
    const addedLines = [];

    while (index < ops.length) {
      const current = ops[index];
      if (current.type === 'context') break;
      if ((current.hunkId || hunkId) !== hunkId) break;

      if (current.type === 'delete') {
        deletedLines.push(current.content);
      } else if (current.type === 'add') {
        addedLines.push(current.content);
      }

      index += 1;
    }

    segments.push({ type: 'change', hunkId, deletedLines, addedLines });
  }

  return segments;
};

export default DiffReviewView;
