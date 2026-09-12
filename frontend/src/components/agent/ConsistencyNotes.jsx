/**
 * ConsistencyNotes —— change set 资产的提示性一致性标注（评估 P4）。
 *
 * 后端 `ConsistencyAnnotationService` 在提案生成后、作者审阅前对每个章节资产
 * 附加 `consistency_annotations`（相关既有事实 / 称呼核对）。本组件只做只读展示：
 * 不影响采纳/拒绝交互、不参与 revision 校验——作者仍是唯一决策者。
 * 纯 presentational，便于 jsdom 渲染测试（P8）。
 */
import React from 'react';
import { AlertTriangle } from 'lucide-react';

/** 标注行：kind 决定图标语义（more=汇总行，无三角）。 */
const NoteLine = ({ note }) => {
  const isMore = String(note?.kind || '') === 'more';
  return (
    <div className="flex items-start gap-1 px-2 py-0.5 text-[10px] leading-relaxed text-[var(--vscode-fg-subtle)]">
      {isMore ? null : <AlertTriangle size={10} className="mt-0.5 shrink-0 text-amber-500" />}
      <span className="min-w-0 flex-1">{String(note?.note || '')}</span>
    </div>
  );
};

const ConsistencyNotes = ({ annotations }) => {
  const notes = Array.isArray(annotations) ? annotations.filter((item) => item && item.note) : [];
  if (!notes.length) return null;
  return (
    <div
      className="mb-0.5 ml-6 border-l-2 border-amber-300/60 bg-amber-50/40 dark:border-amber-500/40 dark:bg-amber-500/5"
      data-testid="consistency-notes"
    >
      {notes.map((note, index) => (
        <NoteLine key={`${note.kind}-${index}`} note={note} />
      ))}
    </div>
  );
};

export default ConsistencyNotes;
