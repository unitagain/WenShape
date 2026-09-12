// @vitest-environment jsdom
/**
 * 渲染层测试底座（评估 P8）：A1 数据丢失级缺陷发生在「组件体内的运行时错误
 * 能穿过 eslint + tsc + Vitest + build 四道关卡」的盲区——纯函数测试覆盖不到。
 * 本文件用最小 jsdom + RTL 覆盖可独立渲染的叶子组件；全局默认环境仍为 node
 * （既有 143 项纯函数测试零成本不变）。
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach } from 'vitest';
import ConsistencyNotes from './ConsistencyNotes';

afterEach(cleanup);

describe('ConsistencyNotes（P4 提示性标注展示）', () => {
  it('有标注时逐条渲染 note 文本', () => {
    render(
      <ConsistencyNotes
        annotations={[
          { kind: 'related_fact', source: 'canon:F1', note: '本章正文涉及既有事实「青铜钥匙」，请核对。' },
          { kind: 'appellation', source: 'cards/relations.yaml', note: '对白未使用设定称呼，请核对。' },
        ]}
      />,
    );
    expect(screen.getByTestId('consistency-notes')).toBeTruthy();
    expect(screen.getByText(/青铜钥匙/)).toBeTruthy();
    expect(screen.getByText(/设定称呼/)).toBeTruthy();
  });

  it('无标注 / 空数组 / 非数组输入时渲染为空（不抛错）', () => {
    const { container } = render(<ConsistencyNotes annotations={[]} />);
    expect(container.querySelector('[data-testid="consistency-notes"]')).toBeNull();
    cleanup();
    const { container: c2 } = render(<ConsistencyNotes annotations={null} />);
    expect(c2.querySelector('[data-testid="consistency-notes"]')).toBeNull();
    cleanup();
    const { container: c3 } = render(<ConsistencyNotes />);
    expect(c3.querySelector('[data-testid="consistency-notes"]')).toBeNull();
  });

  it('无 note 字段的条目被过滤；more 汇总行不渲染警告图标', () => {
    const { container } = render(
      <ConsistencyNotes
        annotations={[
          { kind: 'related_fact', note: '' },
          { kind: 'more', note: '另有 2 条潜在相关项未逐条标注。' },
        ]}
      />,
    );
    expect(screen.getByText(/另有 2 条/)).toBeTruthy();
    // more 行无 AlertTriangle 图标（svg role="img" 来自 lucide）。
    expect(container.querySelectorAll('svg').length).toBe(0);
  });
});
