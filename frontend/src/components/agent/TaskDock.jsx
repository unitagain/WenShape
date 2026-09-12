/**
 * TaskDock —— 停靠在输入框上方的任务栏。
 *
 * 与对话栏同一视觉语言与位置：平时只显示一行摘要，点击展开查看详情，任务执行中默认展开。
 * 左侧两个切换页：
 *   计划——Agent 规划的串行任务与逐步状态；
 *   编辑——本轮改动过的文件，逐个预览并批准。
 *
 * 设计取向：进度用具体步数，不用不透明百分比进度条（业内反模式）；
 * `interrupted` 必须显式呈现，不得伪装完成（§4「incomplete 不伪装 completed」）。
 * 采纳仍复用既有 change set 回调——后端 `apply-change-set` 的原子 revision 校验是唯一 owner。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Check, X, Loader2, CircleDashed, CircleSlash, ChevronDown, FileText, ListTree } from 'lucide-react';
import { useLocale } from '../../i18n';
import ConsistencyNotes from './ConsistencyNotes';

/**
 * 计划终态判定：后端 per-step status 是唯一真相源。
 *  running      执行中
 *  failed       任一步 failed
 *  pending      尚未开始
 *  interrupted  已开始但未跑完（取消/中断/incomplete——A4 后步骤可携带 incomplete/cancelled 终态）
 *  done         全部完成
 */
export const planOutcome = (steps = [], { executing = false } = {}) => {
  if (executing) return 'running';
  if (!steps.length) return 'pending';
  if (steps.some((step) => step?.status === 'failed')) return 'failed';
  if (steps.every((step) => step?.status === 'done')) return 'done';
  // 一步都没跑过 ≠ 中断。缺了这条，刚生成的计划会红字显示「已中断（完成 0/N 步）」。
  if (steps.every((step) => !step?.status || step.status === 'pending')) return 'pending';
  return 'interrupted';
};

/** 当前执行到第几步（1-based）；无进行中步骤时返回已完成数。 */
export const currentStepIndex = (steps = [], activeStepId = null) => {
  if (activeStepId !== null && activeStepId !== undefined) {
    const index = steps.findIndex((step) => String(step?.id) === String(activeStepId));
    if (index >= 0) return index + 1;
  }
  return steps.filter((step) => step?.status === 'done').length;
};

/**
 * 把逐步实时终态（plan_step_done 事件）合并到 plan.steps 上。
 * 执行期间 HTTP 响应尚未返回，plan 对象里的 status 仍是 pending——以事件为准。
 */
export const mergeStepRuntime = (steps = [], stepRuntime = {}) =>
  steps.map((step) => {
    const runtime = stepRuntime?.[String(step?.id)];
    if (!runtime) return step;
    return {
      ...step,
      status: runtime.status || step?.status,
      terminal_state: runtime.terminalState || step?.terminal_state,
      iterations: runtime.iterations ?? step?.iterations,
      error: runtime.errorCode || step?.error,
    };
  });

/** 资产归属：change set 里 asset_id 等于该步 chapter 的，挂到该步下。 */
export const assetsForStep = (changeSet = [], step = null) => {
  const chapter = String(step?.chapter || '').trim();
  if (!chapter) return [];
  return changeSet.filter((item) => String(item?.asset_id || '').trim() === chapter);
};

/** 未能归属到任何步骤的资产（如大纲变更、非 plan 轮次的全部资产）。 */
export const unassignedAssets = (changeSet = [], steps = []) => {
  const owned = new Set(
    steps.flatMap((step) => assetsForStep(changeSet, step).map((item) => `${item?.asset_type}:${item?.asset_id}`)),
  );
  return changeSet.filter((item) => !owned.has(`${item?.asset_type}:${item?.asset_id}`));
};

const STEP_ICONS = { done: Check, failed: X, running: Loader2, pending: CircleDashed };
const assetLabel = (item) => (String(item?.asset_type || '') === 'outline' ? '大纲' : String(item?.asset_id || ''));

/** 任务行标题：优先用 planner 给的简短 title，回退为截断的 description（列表要一行读完）。 */
export const stepLabel = (step, limit = 18) => {
  const title = String(step?.title || '').trim();
  if (title) return title;
  const description = String(step?.description || '').trim();
  return description.length > limit ? `${description.slice(0, limit)}…` : description;
};

// 非完成终态（A4）：incomplete/cancelled 步骤复用中断图标，不显示为 done/绿色。
const STEP_FALLBACK_ICON = CircleSlash;

const StepRow = ({ step, isCurrent }) => {
  const status = isCurrent ? 'running' : step?.status || 'pending';
  const Icon = STEP_ICONS[status] || STEP_FALLBACK_ICON;
  const done = status === 'done';
  const notDoneTerminal = ['failed', 'incomplete', 'cancelled'].includes(status);
  return (
    <div className="flex items-center gap-2 rounded-[4px] px-1 py-0.5 text-[11px]" title={step?.description || ''}>
      <Icon
        size={12}
        className={[
          'shrink-0',
          status === 'failed'
            ? 'text-red-600'
            : done
              ? 'text-green-600'
              : notDoneTerminal
                ? 'text-amber-600'
                : 'text-[var(--vscode-fg-subtle)]',
          status === 'running' ? 'animate-spin' : '',
        ].join(' ')}
      />
      <span
        className={[
          'min-w-0 flex-1 truncate',
          done ? 'text-[var(--vscode-fg-subtle)] line-through' : 'text-[var(--vscode-fg)]',
        ].join(' ')}
      >
        {stepLabel(step)}
      </span>
      {step?.chapter ? (
        <span className="shrink-0 font-mono text-[10px] text-[var(--vscode-fg-subtle)]">{step.chapter}</span>
      ) : null}
      {notDoneTerminal && (step?.terminal_state || step?.error) ? (
        <span className="shrink-0 text-[10px] text-amber-700">
          {step?.error || step?.terminal_state}
        </span>
      ) : null}
    </div>
  );
};

const AssetRow = ({ item, selected, onSelect, onAccept, onReject, labels }) => (
  <div>
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onSelect?.(item)}
        className={[
          'inline-flex min-w-0 flex-1 items-center gap-1 truncate rounded-[4px] px-2 py-1 text-left text-[11px] transition-colors',
          selected
            ? 'bg-[var(--vscode-list-active)] text-[var(--vscode-list-active-fg)]'
            : 'text-[var(--vscode-fg)] hover:bg-[var(--vscode-list-hover)]',
        ].join(' ')}
      >
        <FileText size={11} className="shrink-0" />
        <span className="truncate">{assetLabel(item)}</span>
      </button>
      <button type="button" title={labels.reject} onClick={() => onReject?.(item)} className="p-1 text-red-600 hover:bg-red-50">
        <X size={12} />
      </button>
      <button type="button" title={labels.accept} onClick={() => onAccept?.(item)} className="p-1 text-green-700 hover:bg-green-50">
        <Check size={12} />
      </button>
    </div>
    {/* 提示性一致性标注：只读展示，不属于采纳/拒绝交互（评估 P4）。 */}
    <ConsistencyNotes annotations={item?.consistency_annotations} />
  </div>
);

const TabButton = ({ active, onClick, icon: Icon, label, badge }) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    className={[
      'inline-flex items-center gap-1 rounded-[6px] border px-2 py-1 text-[10px] transition-colors',
      active
        ? 'border-[var(--vscode-input-border)] bg-[var(--vscode-list-active)] text-[var(--vscode-list-active-fg)]'
        : 'border-[var(--vscode-sidebar-border)] text-[var(--vscode-fg-subtle)] hover:text-[var(--vscode-fg)]',
    ].join(' ')}
  >
    <Icon size={12} />
    {badge ? <span className="font-mono">{badge}</span> : null}
  </button>
);

export const TaskDock = ({
  plan = null,
  executing = false,
  activeStepId = null,
  stepRuntime = null,
  changeSet = [],
  activeAsset = null,
  diffSummary = null,
  onSelectAsset,
  onAcceptAsset,
  onRejectAsset,
  onAcceptAll,
  onRejectAll,
  onApplyAccepted,
  onDismiss,
}) => {
  const { t } = useLocale();
  const steps = useMemo(() => {
    const raw = Array.isArray(plan?.steps) ? plan.steps : [];
    return stepRuntime ? mergeStepRuntime(raw, stepRuntime) : raw;
  }, [plan, stepRuntime]);
  const assets = Array.isArray(changeSet) ? changeSet : [];
  const hasPlan = steps.length > 0;
  const hasAssets = assets.length > 0;

  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState('plan');

  // 任务进行时默认展开；结束后交还给用户控制（不强制收起，避免刚跑完就看不到结果）。
  useEffect(() => {
    if (executing) setExpanded(true);
  }, [executing]);
  // 没有计划时只剩「编辑」页可看。
  useEffect(() => {
    if (!hasPlan && hasAssets) setTab('changes');
  }, [hasPlan, hasAssets]);

  if (!hasPlan && !hasAssets) return null;

  const outcome = planOutcome(steps, { executing });
  const current = currentStepIndex(steps, activeStepId);
  const doneCount = steps.filter((step) => step?.status === 'done').length;
  const activeTab = tab === 'changes' && !hasAssets ? 'plan' : tab;
  const isSelected = (item) =>
    String(item?.asset_type || '') === String(activeAsset?.asset_type || '') &&
    String(item?.asset_id || '') === String(activeAsset?.asset_id || '');
  const assetLabels = { accept: t('diff.accept'), reject: t('diff.reject') };

  const summary = hasPlan
    ? outcome === 'running'
      ? t('agentPanel.planStep').replace('{n}', current).replace('{total}', steps.length)
      : t('agentPanel.taskSummary').replace('{n}', doneCount).replace('{total}', steps.length)
    : t('agentPanel.taskChangesSummary').replace('{n}', assets.length);

  return (
    <div className="mb-2 overflow-hidden rounded-[8px] border border-[var(--vscode-sidebar-border)] bg-[var(--vscode-input-bg)] shadow-sm">
      {expanded ? (
        <div className="custom-scrollbar max-h-56 space-y-1 overflow-y-auto border-b border-[var(--vscode-sidebar-border)] px-3 py-2">
          {activeTab === 'plan' ? (
            hasPlan ? (
              steps.map((step, index) => (
                <StepRow
                  key={step?.id ?? index}
                  step={step}
                  isCurrent={outcome === 'running' && index + 1 === current}
                />
              ))
            ) : (
              <div className="px-1 py-2 text-[11px] text-[var(--vscode-fg-subtle)]">{t('agentPanel.taskNoPlan')}</div>
            )
          ) : (
            <>
              {diffSummary ? (
                <div className="px-1 pb-1 text-[10px] text-[var(--vscode-fg-subtle)]">
                  {t('agentPanel.diffStats')
                    .replace('{add}', diffSummary.additions)
                    .replace('{del}', diffSummary.deletions)}
                </div>
              ) : null}
              {assets.map((item) => (
                <AssetRow
                  key={`${item?.asset_type}:${item?.asset_id}`}
                  item={item}
                  selected={isSelected(item)}
                  onSelect={onSelectAsset}
                  onAccept={onAcceptAsset}
                  onReject={onRejectAsset}
                  labels={assetLabels}
                />
              ))}
            </>
          )}
        </div>
      ) : null}

      {/* 摘要条：与输入框同宽同圆角，构成一体的底部控件区 */}
      <div className="flex items-center gap-2 px-2 py-1.5">
        <TabButton
          active={activeTab === 'plan'}
          onClick={() => {
            setTab('plan');
            setExpanded(true);
          }}
          icon={ListTree}
          label={t('agentPanel.taskPlanTab')}
          badge={hasPlan ? `${doneCount}/${steps.length}` : ''}
        />
        <TabButton
          active={activeTab === 'changes'}
          onClick={() => {
            setTab('changes');
            setExpanded(true);
          }}
          icon={FileText}
          label={t('agentPanel.taskChangesTab')}
          badge={hasAssets ? String(assets.length) : ''}
        />

        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="inline-flex min-w-0 flex-1 items-center gap-1 truncate text-left text-[11px] text-[var(--vscode-fg-subtle)] transition-colors hover:text-[var(--vscode-fg)]"
        >
          {executing ? <Loader2 size={11} className="shrink-0 animate-spin" /> : null}
          {outcome === 'interrupted' ? <CircleSlash size={11} className="shrink-0 text-red-600" /> : null}
          <span className="truncate">{summary}</span>
          <ChevronDown
            size={12}
            className={expanded ? 'shrink-0 transition-transform' : 'shrink-0 -rotate-90 transition-transform'}
          />
        </button>

        {hasAssets ? (
          <>
            <button
              type="button"
              onClick={onRejectAll}
              title={t('agentPanel.rejectAll')}
              className="rounded-[6px] border border-red-200 px-2 py-1 text-[10px] text-red-600 transition-colors hover:bg-red-50"
            >
              {t('agentPanel.rejectAll')}
            </button>
            <button
              type="button"
              onClick={onAcceptAll}
              title={t('agentPanel.acceptAll')}
              className="rounded-[6px] border border-green-200 px-2 py-1 text-[10px] text-green-700 transition-colors hover:bg-green-50"
            >
              {t('agentPanel.acceptAll')}
            </button>
            <button
              type="button"
              onClick={onApplyAccepted}
              className="rounded-[6px] border border-[var(--vscode-input-border)] bg-[var(--vscode-list-active)] px-2 py-1 text-[10px] text-[var(--vscode-list-active-fg)] transition-colors hover:opacity-90"
            >
              {t('agentPanel.applyAccepted')}
            </button>
          </>
        ) : null}
        {onDismiss && !executing ? (
          <button
            type="button"
            onClick={onDismiss}
            title={t('agentPanel.planDismiss')}
            className="p-1 text-[var(--vscode-fg-subtle)] transition-colors hover:text-[var(--vscode-fg)]"
          >
            <X size={12} />
          </button>
        ) : null}
      </div>
    </div>
  );
};

export default TaskDock;
