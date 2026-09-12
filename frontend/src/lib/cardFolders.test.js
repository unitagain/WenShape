/**
 * U9 · 卡片文件夹模型回归。
 *
 * 关键不变量：文件夹只是视图状态——删除文件夹绝不带走卡片，坏数据一律安全降级。
 */
import { describe, expect, it } from 'vitest';
import {
  assignCard,
  cardKeyOf,
  createFolder,
  deleteFolder,
  emptyFolderState,
  groupCards,
  normalizeFolderState,
  renameFolder,
} from './cardFolders';

const card = (name, type = 'character') => ({ name, type });

describe('cardFolders 模型', () => {
  it('新建后可把卡片分配进去', () => {
    let state = createFolder(emptyFolderState(), '主角团', 'f1');
    state = assignCard(state, cardKeyOf(card('千羽')), 'f1');
    expect(state.assign['character:千羽']).toBe('f1');
  });

  it('删除文件夹时卡片回到未分组，不被删除', () => {
    let state = createFolder(emptyFolderState(), '配角', 'f1');
    state = assignCard(state, cardKeyOf(card('千雪')), 'f1');
    state = deleteFolder(state, 'f1');

    expect(state.folders).toHaveLength(0);
    expect(state.assign).toEqual({});
    const groups = groupCards([card('千雪')], state);
    expect(groups[groups.length - 1].cards.map((item) => item.name)).toEqual(['千雪']);
  });

  it('传空 folderId 表示移出到未分组', () => {
    let state = createFolder(emptyFolderState(), 'A', 'f1');
    state = assignCard(state, 'character:千羽', 'f1');
    state = assignCard(state, 'character:千羽', '');
    expect(state.assign).toEqual({});
  });

  it('分组保持文件夹顺序，未分组永远在最后，空文件夹仍然显示', () => {
    let state = createFolder(emptyFolderState(), 'A', 'f1');
    state = createFolder(state, 'B', 'f2');
    state = assignCard(state, 'character:甲', 'f2');

    const groups = groupCards([card('甲'), card('乙')], state);
    expect(groups.map((group) => group.folder?.id ?? null)).toEqual(['f1', 'f2', null]);
    expect(groups[0].cards).toEqual([]);
    expect(groups[1].cards.map((item) => item.name)).toEqual(['甲']);
    expect(groups[2].cards.map((item) => item.name)).toEqual(['乙']);
  });

  it('同名不同类型的卡片互不干扰', () => {
    expect(cardKeyOf(card('雨', 'character'))).not.toBe(cardKeyOf(card('雨', 'world')));
  });

  it('重命名只改目标文件夹，空名忽略', () => {
    const state = createFolder(emptyFolderState(), 'A', 'f1');
    expect(renameFolder(state, 'f1', '主角团').folders[0].name).toBe('主角团');
    expect(renameFolder(state, 'f1', '   ').folders[0].name).toBe('A');
  });

  it('坏数据安全降级：指向不存在文件夹的分配被丢弃', () => {
    const state = normalizeFolderState({ folders: [{ id: 'f1', name: 'A' }], assign: { 'character:甲': 'ghost' } });
    expect(state.assign).toEqual({});
    expect(normalizeFolderState(null)).toEqual(emptyFolderState());
    expect(normalizeFolderState({ folders: 'x' })).toEqual(emptyFolderState());
  });
});
