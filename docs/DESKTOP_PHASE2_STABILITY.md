# WenShape 桌面壳阶段 2 稳定性实现说明

更新日期：2026-04-08

阶段 2 的目标是把桌面壳从“最小可运行”推进到“可日常开发使用”的稳定状态。本阶段不处理自动更新、签名、账号与正式分发，只聚焦本地运行时治理。

## 本阶段已落地的内容

1. 统一运行目录
   - 新增 `desktop/main/paths.cjs`
   - 开发态默认使用仓库根目录下的 `.desktop-runtime/`
   - 目录统一收敛为 `data/`、`config/`、`logs/`、`cache/`
   - 当 `.desktop-runtime/data/` 为空时，会从旧的仓库根 `data/` 做一次非破坏性初始化复制

2. 主进程日志基础设施
   - 新增 `desktop/main/logging.cjs`
   - 主进程日志会追加写入 `logs/desktop-main.log`
   - 增加 `uncaughtException` 与 `unhandledRejection` 记录

3. sidecar 生命周期治理
   - 重写 `desktop/main/sidecar.cjs`
   - 启动时增加健康检查与“启动前退出”探测
   - 写作引擎异常退出后支持有限次数自动恢复
   - 退出应用时确保 sidecar 被显式回收

4. 启动页与错误页
   - `desktop/main/runtime.cjs` 提供启动页与故障页构建能力
   - 启动阶段可显示当前状态、目录路径和恢复进度
   - 失败时输出明确的日志目录与运行目录信息

5. preload 状态桥
   - `desktop/preload/index.cjs` 暴露 `getShellStatus()` 与 `onShellStatus()`
   - 启动页和未来 renderer UI 都可以复用同一套状态通道

6. 打包前的后端适配
   - `backend/app/main.py` 在桌面壳模式下不再尝试自动打开浏览器

## 阶段 2 之后的运行方式

开发态建议：

```bash
cd desktop
npm run doctor
npm run dev
```

桌面壳会完成以下动作：

1. 创建或校验 `.desktop-runtime/`
2. 建立日志目录与缓存目录
3. 拉起 Python sidecar
4. 检查 `/health`
5. 加载 Electron 主窗口

## 本阶段未覆盖的内容

- 自动更新与版本通道
- 托盘、深链、原生文件对话框
- 账号登录与联网授权
- 安装器、签名、发布流水线

这些内容仍应按 `plan_now.md` 的后续阶段继续推进。
