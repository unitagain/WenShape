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

### 前置要求

在开始之前，请确保您的系统已安装以下软件：

| 软件 | 最低版本 | 下载地址 |
| :--- | :--- | :--- |
| **Python** | 3.10+ | [python.org/downloads](https://www.python.org/downloads/) |
| **Node.js** | 18+ | [nodejs.org](https://nodejs.org/) |

> **💡 提示**: 安装后请重启终端以确保环境变量生效。

### 一键启动

**1. 克隆仓库**

```bash
git clone https://github.com/unitagain/NOVIX.git
cd NOVIX
```

**2. 运行启动脚本**

```bash
# Windows
start.bat

# macOS/Linux
./start.sh
```

脚本会自动完成以下操作：
- ✅ 检测 Python 和 Node.js 环境
- ✅ 创建 Python 虚拟环境并安装后端依赖
- ✅ 安装前端 npm 依赖
- ✅ 启动后端服务 (`http://localhost:8000`)
- ✅ 启动前端服务 (`http://localhost:3000`)

**3. 访问应用**

启动成功后，脚本会显示访问地址：

- 🌐 **前端界面**: http://localhost:3000
- 📡 **后端 API**: http://localhost:8000
- 📖 **API 文档**: http://localhost:8000/docs

### 配置 LLM (可选)

首次运行会自动生成 `backend/.env` 配置文件。您可以：

**选项 1: 使用真实 API**

编辑 `backend/.env`，填入您的 API Key：

```env
OPENAI_API_KEY=sk-...
# 或
ANTHROPIC_API_KEY=sk-ant-...
# 或
DEEPSEEK_API_KEY=...
```

**选项 2: 使用 Mock 模式** (无需 API Key)

```env
NOVIX_LLM_PROVIDER=mock
```

也可以直接在前端界面的 **"LLM 设置"** 中配置，无需手动编辑文件。

### 常见问题

<details>
<summary><b>Q: 提示找不到 Python 或 Node.js？</b></summary>

请确认已正确安装并重启终端。验证方法：

```bash
python --version  # 应显示 3.10+ 
node --version    # 应显示 18+
```
</details>

<details>
<summary><b>Q: 端口被占用怎么办？</b></summary>

默认端口为 3000 (前端) 和 8000 (后端)。如需修改：
- 前端: 编辑 `frontend/vite.config.js`
- 后端: 编辑 `backend/.env` 添加 `PORT=8080`
</details>

<details>
<summary><b>Q: 如何停止服务？</b></summary>

关闭启动脚本打开的两个终端窗口即可。
</details>

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
