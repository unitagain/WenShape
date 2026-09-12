import { describe, expect, it } from 'vitest';
import {
  chapterBaselineEntries,
  isDestructiveEmptyWrite,
  isKnownBaseline,
  readBaseline,
  resolveDiffBaseline,
  seedBaseline,
  shouldBlockEmptyAutosave,
} from './chapterBaseline';

// U10-A1 的核心不变量：**未知 ≠ 空**。
// 这些用例冻结的是一条数据丢失链——把「没加载过」当成「内容是空」，
// 再把伪造的空串当权威原文写回缓存，最终由 autosave 覆盖磁盘正文。
describe('chapterBaseline · 未知与空的区分', () => {
  it('只有字符串算已知基线；undefined / null 是未知', () => {
    expect(isKnownBaseline('')).toBe(true); // 已知为空
    expect(isKnownBaseline('正文')).toBe(true);
    expect(isKnownBaseline(undefined)).toBe(false);
    expect(isKnownBaseline(null)).toBe(false);
  });

  it('播种未知值时不写入，绝不把 undefined 兜底成空串', () => {
    const store = {};
    expect(seedBaseline(store, 'V1C2', undefined)).toBe(false);
    expect('V1C2' in store).toBe(false);
    expect(readBaseline(store, 'V1C2')).toBeUndefined();
  });

  it('播种已知空串是允许的——作者真的清空过这一章', () => {
    const store = {};
    expect(seedBaseline(store, 'V1C2', '')).toBe(true);
    expect(readBaseline(store, 'V1C2')).toBe('');
  });

  it('readBaseline 对未播种的章节返回 undefined 而不是空串', () => {
    expect(readBaseline({}, 'V1C9')).toBeUndefined();
    expect(readBaseline(null, 'V1C9')).toBeUndefined();
  });
});

describe('chapterBaseline · diff 基线取值优先级', () => {
  const changeSet = [
    { asset_type: 'chapter', asset_id: 'V1C1', original: '第一章原文', revised: '第一章新稿' },
    { asset_type: 'chapter', asset_id: 'V1C2', original: '第二章原文', revised: '第二章新稿' },
    { asset_type: 'outline', asset_id: 'outline', original: '大纲', revised: '新大纲' },
  ];

  it('优先取 change_set 中该资产的权威 original', () => {
    const store = { V1C1: '本地陈旧快照' };
    expect(resolveDiffBaseline({ changeSet, assetId: 'V1C1', store, key: 'V1C1' })).toBe('第一章原文');
  });

  it('change_set 没有该资产时回落到本地播种的快照', () => {
    const store = { V1C8: '第八章原文' };
    expect(resolveDiffBaseline({ changeSet, assetId: 'V1C8', store, key: 'V1C8' })).toBe('第八章原文');
  });

  it('两处都没有时返回未知，而不是空串', () => {
    expect(resolveDiffBaseline({ changeSet, assetId: 'V1C9', store: {}, key: 'V1C9' })).toBeUndefined();
  });

  it('不会把 outline 资产的 original 误当成章节基线', () => {
    expect(resolveDiffBaseline({ changeSet, assetId: 'outline', store: {}, key: 'outline' })).toBeUndefined();
  });

  it('多资产 turn 中每个章节都能取到各自基线（不只 primary）', () => {
    const entries = chapterBaselineEntries(changeSet);
    expect(entries).toEqual([
      ['V1C1', '第一章原文'],
      ['V1C2', '第二章原文'],
    ]);
  });
});

describe('chapterBaseline · autosave 空内容护栏', () => {
  it('拦截凭空变空：内容与用户最后一次输入对不上', () => {
    expect(
      shouldBlockEmptyAutosave({
        next: '',
        lastKnown: '磁盘上的正文',
        lastUserInput: { chapter: 'V1C1', content: '磁盘上的正文' },
        chapter: 'V1C1',
      }),
    ).toBe(true);
  });

  it('放行作者主动清空：空内容正是本章最后一次用户输入', () => {
    expect(
      shouldBlockEmptyAutosave({
        next: '',
        lastKnown: '磁盘上的正文',
        lastUserInput: { chapter: 'V1C1', content: '' },
        chapter: 'V1C1',
      }),
    ).toBe(false);
  });

  it('别的章节的清空记录不能为当前章节背书', () => {
    expect(
      shouldBlockEmptyAutosave({
        next: '',
        lastKnown: '第二章正文',
        lastUserInput: { chapter: 'V1C1', content: '' },
        chapter: 'V1C2',
      }),
    ).toBe(true);
  });

  it('原本就是空章节时不拦截（没有可丢失的内容）', () => {
    expect(shouldBlockEmptyAutosave({ next: '', lastKnown: '', chapter: 'V1C1' })).toBe(false);
    expect(shouldBlockEmptyAutosave({ next: '', lastKnown: null, chapter: 'V1C1' })).toBe(false);
  });

  it('非空写入一律放行', () => {
    expect(shouldBlockEmptyAutosave({ next: '新正文', lastKnown: '旧正文', chapter: 'V1C1' })).toBe(false);
  });

  it('只有空白字符的内容同样视为空覆盖', () => {
    expect(isDestructiveEmptyWrite('   \n  ', '磁盘上的正文')).toBe(true);
  });
});

describe('chapterBaseline · 现场故障回归', () => {
  // U10-A1 现场：活动章节 V1C8，AI 同轮改写 V1C1/V1C2。
  // V1C1/V1C2 本会话从未打开过 → 缓存中没有条目。
  it('未打开过的章节不会被伪造出空基线，也不会写进缓存', () => {
    const store = {};
    const cache = {}; // manualContentByChapter：这两章都没有条目

    // stream_start：拿 cache 里的值去播种——缺陷版本会写入 ''
    expect(seedBaseline(store, 'V1C1', cache.V1C1)).toBe(false);
    expect(readBaseline(store, 'V1C1')).toBeUndefined();

    // change_set 到达后，基线应取后端给的权威原文，而非空串
    const changeSet = [{ asset_type: 'chapter', asset_id: 'V1C1', original: '第一章原文', revised: '扩写后' }];
    expect(resolveDiffBaseline({ changeSet, assetId: 'V1C1', store, key: 'V1C1' })).toBe('第一章原文');

    // 即便 change_set 也缺该资产，也必须停在「未知」，不能落成空串
    expect(resolveDiffBaseline({ changeSet, assetId: 'V1C2', store, key: 'V1C2' })).toBeUndefined();
  });
});
