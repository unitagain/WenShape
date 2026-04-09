# WenShape 桌面壳阶段 1 实施说明

更新日期：2026-04-08

阶段 1 的目标是把 `desktop/` 从“阶段 0 基线骨架”推进到“最小可运行桌面壳”。

## 本阶段已落地

1. Electron 主进程入口
   - `desktop/main/index.cjs`
2. 本地运行时工具
   - `desktop/main/runtime.cjs`
3. Python sidecar 启动与健康检查
   - `desktop/main/sidecar.cjs`
4. preload 安全桥
   - `desktop/preload/index.cjs`
5. 桌面开发启动脚本
   - `desktop/scripts/dev.mjs`
6. Electron Forge 脚本与依赖声明
   - `desktop/package.json`

## 当前开发模式

阶段 1 的推荐开发方式：

1. 启动桌面壳开发命令
2. 由桌面脚本拉起前端开发服务器
3. Electron 主进程拉起 Python sidecar
4. Electron 主窗口加载前端开发地址

## 现阶段能力边界

阶段 1 已实现：

- Electron 主窗口
- 开发态加载前端 dev server
- 生产态预留加载本地 sidecar HTTP 地址
- sidecar 端口动态分配
- sidecar 健康检查
- preload 最小桥接
- 启动失败错误页

阶段 1 尚未实现：

- 自动更新
- 托盘
- 深链接
- 账号系统
- 打包签名闭环
- 正式安装器

## 对工程师的直接说明

后续进入阶段 2 时，应继续在当前结构上推进，而不是重新组织桌面目录或重新争论技术路线。
