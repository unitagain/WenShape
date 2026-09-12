import { defineConfig } from 'vitest/config';

// 前端单元测试（Vitest）——对标后端 pytest 的回归网。
// 纯逻辑（helpers / 归约器 / intent 路由）跑 node 环境；渲染层测试在文件头部用
// `// @vitest-environment jsdom` 局部切换（如 ConsistencyNotes.test.jsx），全局
// 默认环境保持 node，既有纯函数测试的运行成本不变。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,jsx,ts,tsx}'],
    globals: false,
  },
});
