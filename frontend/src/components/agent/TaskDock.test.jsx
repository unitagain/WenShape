// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import TaskDock from './TaskDock';

vi.mock('../../i18n', () => ({ useLocale: () => ({ t: (key) => key }) }));
afterEach(cleanup);

it('执行中的计划收到 incomplete 终态后保留提案并展示中断', () => {
  const plan = { steps: [{ id: 1, status: 'done', description: '第一步' }, { id: 2, status: 'running', description: '第二步' }] };
  const changeSet = [{ asset_type: 'chapter', asset_id: 'V1C002', original: '', revised: '部分提案' }];
  const view = render(<TaskDock plan={plan} executing changeSet={changeSet} />);
  view.rerender(<TaskDock plan={{ steps: [plan.steps[0], { ...plan.steps[1], status: 'incomplete', terminal_state: 'incomplete', error: 'max_iterations' }] }} changeSet={changeSet} />);
  expect(screen.getByText('max_iterations')).toBeTruthy();
  expect(screen.getByText('第二步').className).not.toContain('line-through');
  expect(screen.getByText('第一步').className).toContain('line-through');
});
