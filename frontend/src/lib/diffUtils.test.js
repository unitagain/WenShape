/**
 * U9 · mergeChangeSets —— 计划多步执行时累积待批准文件。
 *
 * 冻结的不变量：先完成的资产不得因后续步骤而从待批准列表消失。
 */
import { describe, expect, it } from 'vitest';
import { mergeChangeSets } from './diffUtils';

const asset = (id, revised = 'x', type = 'chapter') => ({
  asset_type: type,
  asset_id: id,
  original: 'o',
  revised,
});

describe('mergeChangeSets', () => {
  it('累积不同资产，保持先后顺序', () => {
    const merged = mergeChangeSets([asset('V1C1')], [asset('V1C2')]);
    expect(merged.map((item) => item.asset_id)).toEqual(['V1C1', 'V1C2']);
  });

  it('同一资产保留较新的一份且不改变位置', () => {
    const merged = mergeChangeSets([asset('V1C1', '旧'), asset('V1C2')], [asset('V1C1', '新')]);
    expect(merged.map((item) => item.asset_id)).toEqual(['V1C1', 'V1C2']);
    expect(merged[0].revised).toBe('新');
  });

  it('章节与大纲同 id 时按类型区分', () => {
    const merged = mergeChangeSets([asset('outline', 'a', 'outline')], [asset('outline', 'b', 'chapter')]);
    expect(merged).toHaveLength(2);
  });

  it('空输入与非对象项安全降级', () => {
    expect(mergeChangeSets()).toEqual([]);
    expect(mergeChangeSets([null, undefined], [asset('V1C1')])).toHaveLength(1);
  });
});
