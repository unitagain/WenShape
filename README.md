<p align="center">
  <svg width="480" height="140" viewBox="0 0 480 140" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="NOVIX">
    <defs>
      <linearGradient id="novixGradient" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#6EE7B7" />
        <stop offset="50%" stop-color="#34D399" />
        <stop offset="100%" stop-color="#22C55E" />
      </linearGradient>
    </defs>
    <text
      x="50%"
      y="50%"
      text-anchor="middle"
      dominant-baseline="middle"
      font-family="Arial Rounded MT Bold, Nunito, Poppins, Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
      font-size="88"
      font-weight="800"
      letter-spacing="-5"
      fill="url(#novixGradient)"
    >
      NOVIX
    </text>
  </svg>
</p>

<h3 align="center">Multi-Agent Novel Writing System</h3>
<p align="center">
  <strong>多智能体小说写作系统 · 以上下文工程驱动长篇创作</strong>
</p>

<p align="center">
  <a href="#快速开始"><strong>快速开始</strong></a> ·
  <a href="#核心特性"><strong>核心特性</strong></a> ·
  <a href="#为什么选择-novix"><strong>为什么选择 NOVIX</strong></a> ·
  <a href="#架构设计"><strong>架构设计</strong></a> ·
  <a href="https://github.com/unitagain/NOVIX/issues"><strong>贡献与反馈</strong></a>
</p>

<p align="center">
  <a href="https://github.com/unitagain/NOVIX/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License">
  </a>
  <a href="https://github.com/unitagain/NOVIX/stargazers">
    <img src="https://img.shields.io/github/stars/unitagain/NOVIX?style=social" alt="GitHub stars">
  </a>
  <a href="https://github.com/unitagain/NOVIX/network/members">
    <img src="https://img.shields.io/github/forks/unitagain/NOVIX?style=social" alt="GitHub forks">
  </a>
</p>

<br>

## 什么是 NOVIX？

NOVIX 是一个开源的 **多智能体协作写作框架**，通过 **工业级上下文工程** 解决 AI 长篇小说创作中的核心难题：**一致性崩塌** 与 **质量不可控**。

我们不是简单地"让 AI 写小说"，而是构建了一套 **可追溯、可迭代、可协作** 的创作流水线：

- 🤖 **四个智能体分工协作**：模拟现实文学团队（资料管理员 → 撰稿人 → 审稿人 → 编辑）
- 📚 **结构化知识管理**：卡片系统、事实表、时间线让长篇设定不再失控
- 🔄 **用户深度参与**：每轮产出都要你的反馈，AI 是助手而非黑盒
- 💾 **Git 友好存储**：所有资产文件化（YAML/JSON/Markdown），可 diff、可回滚、可协作

## 核心特性

### 🎯 解决的核心问题

传统 AI 写作工具的痛点：
- ❌ **一致性崩塌**：写到后面忘记前面的设定
- ❌ **质量不可控**：无法干预生成过程，只能"赌运气"
- ❌ **黑盒操作**：看不到 AI 的"思考过程"，无法追溯错误根源

NOVIX 的解决方案：
- ✅ **结构化知识库**：卡片 + 事实表 + 时间线，长篇设定永不丢失
- ✅ **多智能体协作**：四个角色各司其职，流程可见、可控、可优化
- ✅ **用户反馈闭环**：每轮必须人工审核，AI 是助手而非替代品
- ✅ **文件化存储**：所有资产版本可控，支持 Git 协作和回滚

### 🔥 与其他方案的对比

| 维度 | NOVIX | 单次 Prompt | RAG 检索增强 | 传统写作工具 |
|------|-------|-------------|-------------|-------------|
| **长篇一致性** | ⭐⭐⭐⭐⭐ | ⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| **质量可控性** | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| **流程透明度** | ⭐⭐⭐⭐⭐ | ⭐ | ⭐⭐ | ⭐⭐⭐ |
| **协作友好度** | ⭐⭐⭐⭐⭐ | ⭐ | ⭐⭐ | ⭐⭐⭐ |
| **技术门槛** | 中 | 低 | 高 | 低 |

---

## 快速开始

### 📋 环境要求

- **Python 3.10+**（后端）
- **Node.js 18+**（前端）
- **Windows / macOS / Linux**（均支持，以下以 Windows 为例）
- **可选**：OpenAI / Anthropic / DeepSeek API Key（或使用 `mock` 模式演示）

### 🚀 一键启动（推荐）

**1. 克隆仓库**

```bash
git clone https://github.com/unitagain/NOVIX.git
cd NOVIX
```

**2. 启动后端**（新开一个终端）

```bash
cd backend
./run.bat  # Windows
# 或 ./run.sh  # macOS/Linux
```

脚本会自动：
- ✅ 创建 Python 虚拟环境（如果不存在）
- ✅ 安装依赖（`requirements.txt`）
- ✅ 生成 `.env` 配置文件（从 `.env.example` 复制）
- ✅ 启动后端服务于 `http://localhost:8000`

**3. 启动前端**（再开一个终端）

```bash
cd frontend
./run.bat  # Windows
# 或 ./run.sh  # macOS/Linux
```

脚本会自动：
- ✅ 安装 npm 依赖（如果不存在）
- ✅ 启动开发服务器于 `http://localhost:3000`

**4. 打开浏览器**

- 🌐 **前端界面**：http://localhost:3000
- 📡 **后端 API**：http://localhost:8000
- 📖 **API 文档**：http://localhost:8000/docs

### 🔑 配置 LLM（可选）

首次启动会生成 `backend/.env` 文件。你可以：

**方案 A：使用真实 API**（推荐用于正式创作）

编辑 `backend/.env`，填入你的 API Key：

```bash
# 选择一个或多个供应商
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
DEEPSEEK_API_KEY=...

# 设置默认供应商
NOVIX_LLM_PROVIDER=openai  # 或 anthropic, deepseek
```

**方案 B：使用 Mock 模式**（快速演示，无需 API Key）

```bash
NOVIX_LLM_PROVIDER=mock
```

Mock 模式会返回模拟的写作内容，用于测试流程和界面。

也可以在前端界面的 **"智能体"** 页面直接配置，无需手动编辑文件。

### ⚠️ 常见问题

<details>
<summary><b>Q: 后端启动失败，提示 Python 版本过低？</b></summary>

请确保 Python 版本 ≥ 3.10：

```bash
python --version
```

如果版本过低，请从 [python.org](https://www.python.org/downloads/) 下载最新版本。
</details>

<details>
<summary><b>Q: 前端启动失败，提示端口被占用？</b></summary>

检查 3000 端口是否被占用：

```bash
# Windows
netstat -ano | findstr :3000

# macOS/Linux
lsof -i :3000
```

可以在 `frontend/vite.config.js` 中修改端口。
</details>

<details>
<summary><b>Q: API Key 配置后仍然提示未配置？</b></summary>

1. 确认 `.env` 文件在 `backend/` 目录下
2. 确认没有多余的空格或引号
3. 重启后端服务
4. 或在前端界面的"智能体"页面重新保存配置
</details>

---

## 为什么选择 NOVIX

### 1) 多智能体协作：把“写作”拆成可控流程

NOVIX 不是单个提示词的一次性生成，而是将创作过程拆成可重复、可回溯的流水线。系统内置四个角色：

- **资料管理员（Archivist）**：维护卡片与 Canon，并为当前章节整理“场景简报”
- **撰稿人（Writer）**：依据场景简报写初稿
- **审稿人（Reviewer）**：做一致性/逻辑/文风审查，输出问题清单与修改建议
- **编辑（Editor）**：根据审稿意见修订与润色

通过后端的 **Orchestrator** 进行调度（而不是把所有职责塞给一个 Agent），优势在于：

- **职责隔离**：每个角色只做自己擅长的事，输出更稳定
- **可迭代**：任意环节可以回退重做（例如根据反馈重跑审稿/编辑）
- **可审计**：每一步都有结构化产物（scene brief、review、draft versions）

### 2) 上下文工程优先：让长篇“一致性可管理”

长篇创作的难点不是“写不出来”，而是“写到后面会忘、会漂、会自相矛盾”。NOVIX 把上下文当作一等公民：

- **卡片系统（Cards）**：角色 / 世界观 / 规则 / 文风以结构化文件维护
- **Canon（事实与时间线）**：以 `jsonl` 累积关键事实、时间线、角色状态，让后续章节可对齐、可追溯
- **上下文引擎（Context Engine）**：选择（selector）+ 压缩（compressor）+ 预算控制（budgeter），为每次调用拼装“恰到好处的上下文”

这意味着：

- 不必把整个项目“全量塞进 prompt”
- 你可以逐步维护设定资产，而不是反复在提示词里补丁式修修补补

### 3) 文件化资产：天然 Git 友好、适合协作与回滚

NOVIX 将核心资产落到可读、可 diff 的文件（YAML/JSON/Markdown）。你可以：

- 用 `git diff` 查看设定、草稿、审稿意见的变化
- 用 `git revert` 回滚到任何一次稳定版本
- 多人并行编辑不同卡片/章节，并通过 PR 讨论

### 4) LLM 网关与按角色覆盖：为“不同任务”选择合适模型

后端提供 LLM 网关，并支持多供应商（OpenAI / Anthropic / DeepSeek / Mock）。你可以设置：

- **默认 Provider**：全局默认使用的供应商
- **按 Agent 覆盖 Provider**：例如 Writer 用更擅长创作的模型，Reviewer 用更擅长分析的模型

前端也提供了“智能体”页面用于配置与保存（写入后端 `.env` 并热更新）。

---

## 技术栈

### 前端

- React + Vite
- TailwindCSS
- React Router
- Axios

### 后端

- FastAPI
- Pydantic
- WebSocket（写作会话实时推送）
- python-dotenv / PyYAML

### 存储

- 文件系统（YAML/JSON/Markdown）
- 面向 Git 的版本管理与协作方式

## 项目结构

```
NOVIX-main/
├── backend/              # FastAPI 后端
│   ├── app/
│   │   ├── agents/       # 多智能体
│   │   ├── context_engine/  # 上下文引擎
│   │   ├── llm_gateway/     # 大模型网关
│   │   ├── orchestrator/    # 调度器
│   │   └── routers/         # API 路由
│   ├── config.yaml
│   └── run.bat
├── frontend/             # React 前端
│   └── run.bat
└── data/                 # 写作项目数据（文件化资产）
```

## 贡献与交流（Contributing）

我们非常欢迎你加入 NOVIX：

- **提 Issue**：Bug、建议、需求、使用体验，都欢迎直接提
- **提 PR**：功能、修复、文档、示例、UI/UX 优化都很有价值
- **讨论设计**：多智能体工作流 / 上下文工程策略 / 长篇一致性治理，都欢迎一起打磨

如果你不确定从哪里开始，直接开一个 Issue 说明你的想法即可，我们会很乐意一起把它变成可落地的改进。

## License

MIT License
