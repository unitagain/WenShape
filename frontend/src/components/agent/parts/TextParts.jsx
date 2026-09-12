/**
 * NarrationPart / AnswerPart / MetaPart —— 四级视觉层级中的后三级（plan.md §9.5 Step 5）。
 *
 *   narration  中：正文色小字段落，无标题无项目符号（agent 工作时的即时说明）
 *   answer     最强：全宽文档式、悬停复制（本轮最终答复）
 *   meta       系统/错误小行，低存在感
 */
import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useLocale } from '../../../i18n';
import { hasMarkdownStructure, parseInline, parseMarkdownBlocks } from '../../../lib/lightMarkdown';

const HEADING_CLASS = {
  1: 'text-sm font-bold',
  2: 'text-[13px] font-bold',
  3: 'text-xs font-bold',
};

const Inline = ({ text }) => (
  <>
    {parseInline(text).map((piece, index) => {
      if (piece.type === 'bold') return <strong key={index} className="font-semibold">{piece.text}</strong>;
      if (piece.type === 'code') {
        return (
          <code
            key={index}
            className="rounded-[3px] bg-[var(--vscode-list-hover)] px-1 font-mono text-[11px]"
          >
            {piece.text}
          </code>
        );
      }
      return <React.Fragment key={index}>{piece.text}</React.Fragment>;
    })}
  </>
);

/**
 * Agent 答复的 Markdown 渲染（轻量子集，见 lib/lightMarkdown.js）。
 * 无结构时退回纯文本，保持原有观感与零风险。
 */
const MarkdownText = ({ text }) => {
  const source = String(text ?? '');
  if (!hasMarkdownStructure(source)) {
    return <span className="whitespace-pre-wrap break-words">{source}</span>;
  }
  return (
    <div className="space-y-2">
      {parseMarkdownBlocks(source).map((block, index) => {
        if (block.type === 'rule') {
          return <hr key={index} className="border-[var(--vscode-sidebar-border)]" />;
        }
        if (block.type === 'heading') {
          return (
            <div key={index} className={`${HEADING_CLASS[block.level] || 'text-xs font-bold'} text-[var(--vscode-fg)]`}>
              <Inline text={block.text} />
            </div>
          );
        }
        if (block.type === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul';
          return (
            <ListTag
              key={index}
              className={block.ordered ? 'list-decimal space-y-0.5 pl-5' : 'list-disc space-y-0.5 pl-5'}
            >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="break-words">
                  <Inline text={item} />
                </li>
              ))}
            </ListTag>
          );
        }
        return (
          <p key={index} className="whitespace-pre-wrap break-words">
            <Inline text={block.text} />
          </p>
        );
      })}
    </div>
  );
};

const CopyButton = ({ text }) => {
  const { t } = useLocale();
  const [done, setDone] = useState(false);
  const onCopy = async () => {
    if (!navigator?.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(String(text || ''));
      setDone(true);
      setTimeout(() => setDone(false), 1200);
    } catch (_e) {
      /* noop */
    }
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      title={t('common.copy')}
      className="opacity-0 group-hover:opacity-100 transition-opacity text-[var(--vscode-fg-subtle)] hover:text-[var(--vscode-fg)]"
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
};

export const NarrationPart = ({ part }) => {
  const paragraphs = String(part?.text || '')
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!paragraphs.length) return null;
  return (
    <div className="space-y-1 text-xs leading-relaxed text-[var(--vscode-fg-subtle)]">
      {paragraphs.map((paragraph, index) => (
        <p key={`${index}-${paragraph.slice(0, 24)}`} className="whitespace-pre-wrap break-words">
          {paragraph}
        </p>
      ))}
    </div>
  );
};

export const AnswerPart = ({ part }) => (
  <div className="group relative text-xs leading-relaxed text-[var(--vscode-fg)] break-words pr-5">
    <MarkdownText text={part?.text} />
    <span className="absolute top-0 right-0">
      <CopyButton text={part?.text} />
    </span>
  </div>
);

export const MetaPart = ({ part }) => {
  const { t } = useLocale();
  const stageKey = `agentPanel.stageLabels.${part?.type}`;
  const stageLabel = t(stageKey);
  const label = stageLabel === stageKey ? '' : stageLabel;
  const isError = part?.type === 'error';
  return (
    <div
      className={[
        'text-[11px] py-0.5 leading-relaxed',
        isError
          ? 'text-red-700'
          : 'text-[var(--vscode-fg-subtle)]',
      ].join(' ')}
    >
      {label && !isError ? <span className="mr-1.5 opacity-70">{label}</span> : null}
      {part?.text}
    </div>
  );
};

export default NarrationPart;
