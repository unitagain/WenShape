# WenShape Desktop Shell Baseline

本目录用于承载 WenShape 的 Electron 桌面壳层。

当前状态对应 `plan_now.md` 中的**阶段 0**，目标是冻结关键工程决策并建立统一基线，而不是直接实现桌面主功能。

## 阶段 0 已冻结的关键决策

- 桌面壳主路线：`Electron`
- 渲染层：复用现有 `frontend/` React + Vite
- 本地业务引擎：复用现有 `backend/` Python + FastAPI sidecar
- 仓库组织方式：单仓库分层，不拆独立桌面仓库
- 平台策略：同一代码仓库，分别产出 Windows 与 macOS 安装包
- 阶段 1 不允许重写 WenShape 创作内核

## 目录职责

- `config/`
  - 桌面壳的机器可读清单、协议名、发布通道、目录规范
- `main/`
  - Electron 主进程代码
- `preload/`
  - Electron 安全桥接层
- `resources/`
  - 图标、安装资源、品牌素材
- `scripts/`
  - 桌面壳工程辅助脚本

## 当前可执行检查

```bash
cd desktop
npm run doctor
```

该命令用于验证：

- Node.js 版本是否满足阶段 0 要求
- 关键目录是否存在
- 桌面壳清单文件是否完整

## 阶段 1 进入条件

进入阶段 1 之前，应满足：

- `desktop/config/shell.manifest.json` 已确认无误
- 目录骨架稳定
- 团队不再对 Electron / Tauri 路线反复讨论
- 前后端主仓库仍保持可运行
