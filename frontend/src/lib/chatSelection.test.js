import { createHash, webcrypto } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { buildChatSelection } from './chatSelection';

afterEach(() => vi.unstubAllGlobals());

it('保留重复片段的精确位置，并把 emoji 前的 UTF-16 范围转换为后端字符范围', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const source = '😀重复\n重复';
  const result = await buildChatSelection({ chapter: 'V1C001', sourceText: source, start: 5, end: 7, text: '重复' }, 'V1C001', source);
  expect(result.selection).toEqual({
    chapter: 'V1C001', start: 4, end: 6,
    source_sha256: createHash('sha256').update(source).digest('hex'),
  });
  expect(result.selection_text).toBe('重复');
});

it('切章或修改正文后拒绝发送旧选区', async () => {
  const candidate = { chapter: 'V1C001', sourceText: '旧正文', start: 0, end: 3, text: '旧正文' };
  await expect(buildChatSelection(candidate, 'V1C002', '旧正文')).rejects.toThrow('重新选择');
  await expect(buildChatSelection(candidate, 'V1C001', '新正文')).rejects.toThrow('重新选择');
});

it('长选区完整传递，不在 6000 字符处静默丢失尾部', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const source = '正文'.repeat(4000) + '尾部哨兵';
  const result = await buildChatSelection({ chapter: 'V1C001', sourceText: source, start: 0, end: source.length, text: source }, 'V1C001', source);
  expect(result.selection_text).toBe(source);
});
