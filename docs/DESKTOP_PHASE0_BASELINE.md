# WenShape 桌面壳阶段 0 基线说明

更新日期：2026-04-08

本文档用于说明已落入仓库的桌面壳阶段 0 产物。

## 目标

阶段 0 的目标不是实现 Electron 应用本身，而是把以下事项工程化冻结：

- 技术路线
- 仓库结构
- 平台目标
- 目录约束
- 版本与通道约束
- 后续阶段可直接承接的桌面工程骨架

## 已落地内容

1. 新增 `desktop/` 顶级目录
2. 新增 `desktop/config/shell.manifest.json`
3. 新增 `desktop/package.json`
4. 新增 `desktop/forge.config.ts`
5. 新增 `desktop/tsconfig.json`
6. 新增 `desktop/scripts/doctor.mjs`
7. 新增 `desktop/main/`、`desktop/preload/`、`desktop/resources/` 边界目录

## 本阶段验证方式

在仓库根目录执行：

```bash
cd desktop
npm run doctor
```

若检查通过，说明：

- 桌面壳基线目录存在
- 清单文件存在且决策未漂移
- Node.js 版本满足约束

## 与阶段 1 的交接边界

阶段 1 可以在此基线之上直接开始实现：

- Electron 主进程入口
- preload 安全桥
- Python sidecar 拉起
- 渲染层接入本地桌面窗口

阶段 1 不应再重新讨论：

- 是否采用 Electron
- 是否拆独立仓库
- 是否重写后端业务引擎
