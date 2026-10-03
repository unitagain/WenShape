// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';
import { sessionAPI } from '../../api';
import ChangeSetRecovery from './ChangeSetRecovery';

vi.mock('../../api', () => ({ sessionAPI: {
  pendingChangeSets: vi.fn(), resumeChangeSet: vi.fn(), discardChangeSet: vi.fn(),
} }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const journal = { journal_id: 'j1', assets: [{ asset_id: 'V1C002', asset_type: 'chapter', original: '原文', revised: '恢复正文', check: { result: 'pending' } }] };
const mount = (onRecovered = vi.fn()) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <ChangeSetRecovery projectId="p1" onRecovered={onRecovered} />
  </SWRConfig>,
);

it('先展示完整恢复预览，作者确认后才发起续做', async () => {
  sessionAPI.pendingChangeSets.mockResolvedValue({ data: { journals: [journal] } });
  sessionAPI.resumeChangeSet.mockResolvedValue({ data: { success: true } });
  const recovered = vi.fn();
  mount(recovered);
  fireEvent.click(await screen.findByText('查看恢复预览'));
  expect(screen.getByText('恢复正文')).toBeTruthy();
  expect(sessionAPI.resumeChangeSet).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('确认继续写入'));
  await waitFor(() => expect(recovered).toHaveBeenCalledWith(journal.assets));
  expect(sessionAPI.resumeChangeSet).toHaveBeenCalledWith('p1', 'j1');
});

it('有冲突时不能续做，仍允许放弃剩余写入', async () => {
  sessionAPI.pendingChangeSets.mockResolvedValue({ data: { journals: [{ ...journal, assets: [{ ...journal.assets[0], check: { result: 'conflict' } }] }] } });
  sessionAPI.discardChangeSet.mockResolvedValue({ data: { success: true } });
  mount();
  fireEvent.click(await screen.findByText('查看恢复预览'));
  expect(screen.getByText('确认继续写入').disabled).toBe(true);
  fireEvent.click(screen.getByText('放弃剩余写入'));
  await waitFor(() => expect(sessionAPI.discardChangeSet).toHaveBeenCalledWith('p1', 'j1'));
});

it('离开项目后到达的恢复响应不能回填编辑器', async () => {
  let finish;
  sessionAPI.pendingChangeSets.mockResolvedValue({ data: { journals: [journal] } });
  sessionAPI.resumeChangeSet.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const recovered = vi.fn();
  const view = mount(recovered);
  fireEvent.click(await screen.findByText('查看恢复预览'));
  fireEvent.click(screen.getByText('确认继续写入'));
  view.unmount();
  await act(async () => { finish({ data: { success: true } }); });
  expect(recovered).not.toHaveBeenCalled();
});
