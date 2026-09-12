/**
 * U9 · 轻量 Markdown 解析回归。
 *
 * 冻结点：模型答复里的 `##` 标题、`-`/`1.` 列表、`**强调**` 必须成为结构，
 * 而无结构文本必须原样走纯文本路径（不改变既有观感）。
 */
import { describe, expect, it } from 'vitest';
import { hasMarkdownStructure, parseInline, parseMarkdownBlocks } from './lightMarkdown';

describe('parseMarkdownBlocks', () => {
  it('解析标题与其后的无序列表', () => {
    const blocks = parseMarkdownBlocks('## 现有伏笔梳理\n- 金色液体\n- 雌雄同体');
    expect(blocks[0]).toEqual({ type: 'heading', level: 2, text: '现有伏笔梳理' });
    expect(blocks[1]).toEqual({ type: 'list', ordered: false, items: ['金色液体', '雌雄同体'] });
  });

  it('有序列表单独成块，支持中文顿号编号', () => {
    const blocks = parseMarkdownBlocks('1. 第一条\n2、第二条');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].ordered).toBe(true);
    expect(blocks[0].items).toEqual(['第一条', '第二条']);
  });

  it('小数不被误判为有序列表项', () => {
    expect(parseMarkdownBlocks('3.14 是圆周率')[0]).toEqual({ type: 'paragraph', text: '3.14 是圆周率' });
  });

  it('有序与无序相邻时不混入同一块', () => {
    const blocks = parseMarkdownBlocks('- a\n1. b');
    expect(blocks.map((block) => block.ordered)).toEqual([false, true]);
  });

  it('空行分段，纯文本仍是 paragraph', () => {
    const blocks = parseMarkdownBlocks('第一段\n\n第二段');
    expect(blocks).toEqual([
      { type: 'paragraph', text: '第一段' },
      { type: 'paragraph', text: '第二段' },
    ]);
  });

  it('分隔线单独成块', () => {
    expect(parseMarkdownBlocks('---')[0]).toEqual({ type: 'rule' });
  });

  it('空输入安全降级', () => {
    expect(parseMarkdownBlocks('')).toEqual([]);
    expect(parseMarkdownBlocks(null)).toEqual([]);
  });
});

describe('parseInline', () => {
  it('拆出粗体与行内代码', () => {
    expect(parseInline('看 **金色液体** 与 `code` 结尾')).toEqual([
      { type: 'text', text: '看 ' },
      { type: 'bold', text: '金色液体' },
      { type: 'text', text: ' 与 ' },
      { type: 'code', text: 'code' },
      { type: 'text', text: ' 结尾' },
    ]);
  });

  it('未闭合标记按普通文本处理', () => {
    expect(parseInline('**没闭合')).toEqual([{ type: 'text', text: '**没闭合' }]);
  });
});

describe('hasMarkdownStructure', () => {
  it('普通对话不触发结构渲染', () => {
    expect(hasMarkdownStructure('好的，我这就去写第三章。')).toBe(false);
  });

  it('标题/列表/粗体都算结构', () => {
    expect(hasMarkdownStructure('## 标题')).toBe(true);
    expect(hasMarkdownStructure('- 项')).toBe(true);
    expect(hasMarkdownStructure('这里有 **强调**')).toBe(true);
  });
});
