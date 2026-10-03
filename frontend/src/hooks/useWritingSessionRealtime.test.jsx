// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createWebSocket } from '../api';
import { useWritingSessionRealtime } from './useWritingSessionRealtime';

vi.mock('../api', () => ({ createWebSocket: vi.fn() }));
vi.mock('../components/ide/TitleBar', () => ({ getStreamingPreference: () => false }));
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  let receive;
  createWebSocket.mockImplementation((_project, callback) => { receive = callback; return { close: vi.fn() }; });
  vi.stubGlobal('WebSocket', class { close() {} });
  const options = { projectId: 'p1', noChapterKey: '__none__', writingLanguage: 'zh', t: (key) => key };
  for (const name of ['addMessage', 'appendProgressEvent', 'clearDiffReview', 'dispatch', 'pushNotice', 'setAgentTraces', 'setIsGenerating', 'setManualContent', 'setStatus', 'setStreamingState', 'setTraceEvents', 'stopStreaming', 'onStreamFinalize', 'onInputRequired']) {
    options[name] = vi.fn();
  }
  for (const name of ['serverStreamActiveRef', 'serverStreamUsedRef', 'streamBufferByChapterRef', 'streamFlushRafByChapterRef', 'streamingChapterKeyRef', 'streamTextByChapterRef', 'traceWsRef', 'wsRef', 'wsStatusRef', 'lastGeneratedByChapterRef', 'streamOriginalByChapterRef']) {
    options[name] = { current: {} };
  }
  options.activeChapterKeyRef = { current: 'V1C002' };
  const contents = { current: { V1C001: '第一章原文', V1C002: '当前章正文' } };
  options.setManualContentByChapter = (update) => { contents.current = update(contents.current); };
  const view = renderHook(() => useWritingSessionRealtime(options));
  return { options, contents, receive, ...view };
}

it('跨章流式更新只回填目标缓存，不清空当前章编辑器', () => {
  const { receive, options, contents } = setup();
  act(() => receive({ type: 'stream_start', chapter: 'V1C001' }));
  act(() => receive({ type: 'token', chapter: 'V1C001', content: '第一章新文' }));
  expect(options.setManualContent).not.toHaveBeenCalled();
  expect(contents.current.V1C002).toBe('当前章正文');
  expect(options.streamOriginalByChapterRef.current.V1C001).toBe('第一章原文');
});

it('卸载后迟到的 WebSocket 回调不能修改下一项目状态', () => {
  const { receive, options, unmount } = setup();
  unmount();
  act(() => receive({ type: 'stream_start', chapter: 'V1C002' }));
  expect(options.setManualContent).not.toHaveBeenCalled();
  expect(options.setIsGenerating).not.toHaveBeenCalled();
});

it('忽略其他项目误投递的流事件', () => {
  const { receive, options } = setup();
  act(() => receive({ type: 'stream_start', project_id: 'p2', chapter: 'V1C002' }));
  expect(options.setManualContent).not.toHaveBeenCalled();
});
