/**
 * U5 · PR-3 交互组件的展示决策回归。
 *
 * 重点：interrupted 不得被判为 done（plan.md §4「incomplete 不伪装 completed」）。
 */
import { describe, expect, it } from 'vitest';
import {
  assetsForStep,
  currentStepIndex,
  mergeStepRuntime,
  planOutcome,
  stepLabel,
  unassignedAssets,
} from '../TaskDock';
import { answeredCount } from './ClarificationPart';

const step = (id, status) => ({ id, status, description: `第 ${id} 步` });

describe('TaskDock.planOutcome', () => {
  it('执行中为 running', () => {
    expect(planOutcome([step(1, 'pending')], { executing: true })).toBe('running');
  });

  it('全部完成为 done', () => {
    expect(planOutcome([step(1, 'done'), step(2, 'done')])).toBe('done');
  });

  it('任一步失败为 failed', () => {
    expect(planOutcome([step(1, 'done'), step(2, 'failed')])).toBe('failed');
  });

  it('已开始但未跑完为 interrupted，不得判为完成', () => {
    expect(planOutcome([step(1, 'done'), step(2, 'pending')])).toBe('interrupted');
  });

  it('一步都没跑过为 pending，不是中断（新生成的计划等待执行）', () => {
    expect(planOutcome([step(1, 'pending')])).toBe('pending');
    expect(planOutcome([step(1, 'pending'), step(2, 'pending')])).toBe('pending');
  });

  it('无步骤为 pending', () => {
    expect(planOutcome([])).toBe('pending');
  });
});

describe('TaskDock.currentStepIndex', () => {
  it('优先按事件里的 step_id 定位当前步（1-based）', () => {
    expect(currentStepIndex([step(1, 'done'), step(2, 'pending'), step(3, 'pending')], 2)).toBe(2);
  });

  it('step_id 缺失时回落为已完成步数', () => {
    expect(currentStepIndex([step(1, 'done'), step(2, 'done'), step(3, 'pending')], null)).toBe(2);
  });

  it('step_id 不在计划内时同样回落', () => {
    expect(currentStepIndex([step(1, 'done')], 99)).toBe(1);
  });
});

// U9 · 任务卡承载 change set 与实时逐步终态
describe('TaskDock.mergeStepRuntime', () => {
  it('执行期间以 plan_step_done 事件覆盖 plan 对象里的 pending 状态', () => {
    const merged = mergeStepRuntime([step(1, 'pending'), step(2, 'pending')], {
      1: { status: 'done', terminalState: 'completed', iterations: 6 },
    });
    expect(merged[0].status).toBe('done');
    expect(merged[0].iterations).toBe(6);
    expect(merged[1].status).toBe('pending');
  });

  it('截断终态如实保留，不改写为完成', () => {
    const merged = mergeStepRuntime([step(1, 'pending')], {
      1: { status: 'done', terminalState: 'incomplete', errorCode: '' },
    });
    expect(merged[0].terminal_state).toBe('incomplete');
  });

  it('无事件时原样返回', () => {
    const steps = [step(1, 'pending')];
    expect(mergeStepRuntime(steps, {})).toEqual(steps);
  });
});

describe('TaskDock 资产归属', () => {
  const changeSet = [
    { asset_type: 'chapter', asset_id: 'V1C1' },
    { asset_type: 'chapter', asset_id: 'V1C2' },
    { asset_type: 'outline', asset_id: 'outline' },
  ];

  it('按 chapter 把资产挂到对应任务行', () => {
    expect(assetsForStep(changeSet, { id: 1, chapter: 'V1C2' })).toEqual([
      { asset_type: 'chapter', asset_id: 'V1C2' },
    ]);
  });

  it('无 chapter 的任务行（非 plan 轮次）不认领任何资产', () => {
    expect(assetsForStep(changeSet, { id: 1 })).toEqual([]);
  });

  it('未归属资产不会丢失——大纲与无主章节仍会呈现', () => {
    const steps = [{ id: 1, chapter: 'V1C1' }];
    expect(unassignedAssets(changeSet, steps).map((item) => item.asset_id)).toEqual(['V1C2', 'outline']);
  });

  it('非 plan 轮次的全部资产都落在未归属区', () => {
    const steps = [{ id: 1 }];
    expect(unassignedAssets(changeSet, steps)).toHaveLength(3);
  });
});

describe('ClarificationPart.answeredCount', () => {
  it('只统计非空回答', () => {
    expect(answeredCount(['甲', '', '  ', '乙'])).toBe(2);
    expect(answeredCount([])).toBe(0);
  });
});

// U9 · 任务行标题必须一行读完（负责人反馈：每条任务字数过多）
describe('TaskDock.stepLabel', () => {
  it('优先用 planner 给的简短 title', () => {
    expect(stepLabel({ title: '优化第一章', description: '对第一章进行感官、细节描写的深度优化拓展' })).toBe('优化第一章');
  });

  it('无 title 时截断 description 并加省略号', () => {
    const label = stepLabel({ description: '对第一章进行感官、细节描写的深度优化拓展' }, 10);
    expect(label).toBe('对第一章进行感官、细…');
    expect(label.length).toBe(11);
  });

  it('短 description 不截断', () => {
    expect(stepLabel({ description: '查证设定' })).toBe('查证设定');
  });

  it('空步骤安全降级', () => {
    expect(stepLabel(null)).toBe('');
    expect(stepLabel({})).toBe('');
  });
});
