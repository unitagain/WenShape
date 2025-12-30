<div align="center">
  <br>
  <h1>NOVIX</h1>
  <p><strong>Context-Aware Multi-Agent Novel Writing System</strong></p>
  <p>多智能体 · 深度上下文 · 沉浸式创作</p>
  <br>

  <p>
    <a href="https://github.com/unitagain/NOVIX/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-71717A?style=flat-square" alt="License"></a>
    <a href="https://github.com/unitagain/NOVIX"><img src="https://img.shields.io/badge/status-active-10B981?style=flat-square" alt="Status"></a>
    <a href="#"><img src="https://img.shields.io/badge/frontend-React-61DAFB?style=flat-square" alt="Frontend"></a>
    <a href="#"><img src="https://img.shields.io/badge/backend-FastAPI-009688?style=flat-square" alt="Backend"></a>
  </p>
  <br>
</div>

---

## 📖 简介 (Introduction)

**NOVIX** 是一个为长篇小说创作而生的多智能体协作系统。我们拒绝将写作视为简单的"提示生成"，而是将其重新定义为一项需要 **结构化工程 (Context Engineering)** 与 **精细分工 (Multi-Agent)** 的精密工艺。

在这个版本中，我们带来了全新的 **"Calm & Focus"** 设计语言——以纸张的质感、优雅的衬线字体和无干扰的极简主义，为您创造一隅静谧的创作空间。

> *"写作不仅是灵感的迸发，更是对庞杂世界的有序构建。"*

## ✨ 核心特性 (Features)

### 🤖 工业级多智能体协作
模拟真实的编辑部工作流，让 AI 不是单纯的"续写机器"，而是各司其职的专业团队：

*   **🗃️ 档案员 (Archivist)**：掌管[卡片系统]与[世界观]，为每一章提供精准的上下文简报。
*   **✍️ 撰稿人 (Writer)**：基于简报专注创作，不受无关信息干扰。
*   **🧐 审阅员 (Reviewer)**：严格审查逻辑漏洞、人设崩塌与文风偏离，输出修改意见。
*   **📝 编辑 (Editor)**：根据审阅意见进行润色与修订，把控最终质量。

### 🧠 深度上下文工程 (Deep Context)
长篇小说的核心难题在于"遗忘"。NOVIX 通过结构化数据解决一致性问题：

*   **卡片系统 (Cards)**：角色、地点、势力、物品，一切皆可卡片化。
*   **动态事实表 (Dynamic Canon)**：随着剧情推进自动累积关键事实与状态。
*   **按需组装**: 每次生成只提取当前场景最相关的 5% 信息，避免 Token 浪费与幻觉。

### 🎨 沉浸式写作体验 (Immersive UI)
*   **纸张质感**: `#FAFAF9` 暖灰背景与柔和阴影，还原书写体验。
*   **排版美学**: 混排 `Noto Serif SC` (宋体) 与 `Inter`，兼顾阅读舒适性。
*   **专注模式**: 自动隐藏无关 UI，让思维随光标流淌。

### 💾 开发者友好 (Git-Native)
*   **文件化存储**: 所有设定与草稿均为 YAML/Markdown 文件。
*   **版本控制**: 天然支持 Git，可 Diff、可回滚、可协作。

---

## 🚀 快速开始 (Quick Start)

### 环境要求
*   **Python 3.10+**
*   **Node.js 18+**

### 1. 启动后端 (Backend)

```bash
cd backend
# 自动创建虚拟环境并运行
./run.bat
```
会自动生成 `.env` 文件。请填入您的 API Key (OpenAI, Anthropic, 或 DeepSeek)，或使用 `mock` 模式体验。

### 2. 启动前端 (Frontend)

```bash
cd frontend
# 自动安装依赖并运行
./run.bat
```

访问: **http://localhost:3000**

---

## 🛠️ 技术栈 (Tech Stack)

| 领域 | 技术方案 |
| :--- | :--- |
| **Frontend** | React, Vite, TailwindCSS (v3), Lucide React |
| **Backend** | FastAPI, Pydantic, Python-dotenv |
| **Data** | YAML (Config), Markdown (Content), JSONL (Logs) |
| **LLM** | OpenAI API Standard (Compatible with DeepSeek/Claude) |

---

## 🤝 贡献 (Contributing)

我们欢迎任何形式的贡献——无论是新的智能体策略、UI 优化，还是简单的文档修正。

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 提交 Pull Request

## 📄 许可证 (License)

Distributed under the MIT License. See `LICENSE` for more information.

<div align="center">
  <br>
  <p>Made with ❤️ by the NOVIX Team</p>
</div>
