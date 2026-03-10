<div align="center">
  <img src="docs/img/logo.svg" alt="文枢 WenShape" width="520" />

  <p>
    <strong>深度上下文感知的智能体小说创作系统</strong><br />
    <em>Deep Context-Aware Agent-Based Novel Writing System</em>
  </p>

  <p>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-PolyForm_NC_1.0.0-525252?style=flat-square" alt="License" /></a>
    <img src="https://img.shields.io/badge/python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python" />
    <img src="https://img.shields.io/badge/react-18-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React" />
    <img src="https://img.shields.io/badge/fastapi-0.109+-009688?style=flat-square&logo=fastapi&logoColor=white" alt="FastAPI" />
  </p>

  <p>
    <a href="./README.en.md">English</a> &middot;
    <a href="#快速上手">快速上手</a> &middot;
    <a href="#使用指南">使用指南</a> &middot;
    <a href="#系统架构">架构</a> &middot;
    <a href="#技术栈">技术栈</a> &middot;
    <a href="#贡献">贡献</a> &middot;
    <a href="#许可协议">许可协议</a>
  </p>
</div>

---

## 文枢是什么

文枢 WenShape 是一个面向长篇小说创作的 **上下文工程（Context Engineering）** 系统。它的核心问题是：当叙事跨越数万字时，LLM 会不可避免地遗忘早期设定、产生前后矛盾。文枢通过**编排式写作流程**、**动态事实追踪**和**精确的 Token 预算管理**来应对这一挑战。

所有项目数据以 YAML / Markdown / JSONL 纯文本存储，天然支持 Git 版本控制。

---

## 核心设计

### 编排式写作流程

系统由一个 Orchestrator（编排器）驱动完整的写作会话。编排器按阶段调度不同的专用模块，每个模块使用独立的系统提示词，可配置不同的 LLM 提供商和生成温度。

一个完整的写作会话实际执行以下流程：

```mermaid
flowchart LR
  A[用户发起写作请求] --> B[阶段 1：场景准备（Archivist）]
  B --> C[阶段 2：上下文构建（Context Engine）]
  C --> D[阶段 3：草稿生成（Writer）]
  D --> E[阶段 4：修订循环（Editor / Writer）]
  E --> F[阶段 5：收尾分析（Archivist）]
```

| 阶段 | 目标 | 关键产物 |
| :--- | :--- | :--- |
| 1 场景准备 | 为“这一章要写什么”建立可检索的结构化入口 | Scene Brief（角色/设定卡、事实、摘要、时间线） |
| 2 上下文构建 | 在有限 Token 预算内把“最相关的信息”组织进上下文 | 记忆包（Working Memory + Evidence 命中 + Gap/Questions） |
| 3 草稿生成 | 以流式方式生成初稿，不确定的细节用模糊叙事绕过 | 草稿正文 |
| 4 修订循环 | 以最小改动完成修改，避免波及无关内容 | Patch 操作（replace/insert/delete）+ Diff 预览 |
| 5 收尾分析 | 将本章沉淀为可检索资产，为后续章节复用 | 章节摘要 + Canon（事实/时间线/状态） |

> **说明**：Archivist / Writer / Editor 并非自主决策的独立智能体，而是由编排器按需调度的专用模块。它们各自维护独立的系统提示词和 LLM 配置，但执行顺序和调用时机由编排器决定。

### 上下文引擎

上下文引擎负责在每次 LLM 调用前，在有限的 Token 预算内选出最相关的信息。

**预算分配策略**（默认 128K Token）：

| 分配对象 | 比例 | 说明 |
| :--- | :--- | :--- |
| 系统规则 | 5% | 行为约束和提示词 |
| 角色/世界观卡片 | 15% | 当前场景相关的设定卡片 |
| 动态事实表 | 10% | 累积的关键剧情事实 |
| 历史摘要 | 20% | 已完成章节的压缩摘要 |
| 当前草稿 | 30% | 正在创作的章节内容 |
| 输出预留 | 20% | 保留给模型生成 |

**选择引擎**采用两层策略：
1. **确定性选择**：风格卡、场景简要等必选项，确保写作风格一致
2. **检索式选择**：对候选卡片（每类最多 50 个）进行 BM25 + 词重叠混合评分，返回 Top-K 最相关项

### 动态事实表（Canon）

系统在每次章节确认后执行收尾分析：通过 LLM 调用提取新产生的事实条目（角色状态变化、地点转移、物品获取等），写入 JSONL 格式的事实表。同时使用启发式规则（基于动作动词、特定后缀、出现频率阈值）检测可能的新角色和世界观设定，以提议形式呈现给用户确认。

后续章节生成时，事实表参与上下文选择引擎的评分排序，确保长篇叙事的一致性。

### 同人创作支持

内置 Wiki 爬取和结构化提取能力，支持从萌娘百科、Fandom、Wikipedia 等站点批量导入角色和世界观信息，自动解析 Infobox 和正文内容，生成可编辑的设定卡片。

---

## 系统架构

```
frontend/ (React 18 + Vite + TypeScript)
├── pages/              页面组件（项目列表、写作会话、系统设置）
├── components/ide/     IDE 式三段布局（ActivityBar + SidePanel + Editor）
├── context/            全局状态管理（IDEContext, Reducer 模式）
├── hooks/              自定义 Hooks（WebSocket 事件追踪、防抖请求）
└── api.ts              统一 API 层（Axios, 12 个模块, WebSocket 重连）

backend/ (FastAPI + Pydantic v2)
├── agents/             专用模块（Archivist / Writer / Editor / Extractor）
│   ├── base.py         基类：统一 LLM 调用、Token 追踪、消息构建
│   ├── writer.py       撰稿人：研究循环 + 流式生成
│   ├── editor.py       编辑：Patch 生成 + 选区编辑 + 回退策略
│   ├── archivist.py    档案员：场景简要 + 事实检测 + 设定评分
│   └── extractor.py    提取器：Wiki → 结构化卡片
├── orchestrator/       编排器
│   ├── orchestrator.py 写作会话全流程协调
│   ├── _context_mixin  上下文和记忆包准备
│   └── _analysis_mixin 章节分析和事实表更新
├── context_engine/     上下文引擎
│   ├── select_engine   两层选择策略（确定性 + 检索式）
│   ├── budget_manager  Token 预算分配与追踪
│   └── smart_compressor 历史对话智能压缩
├── llm_gateway/        LLM 网关
│   ├── gateway.py      统一接口：重试、流式、成本追踪
│   └── providers/      9 个提供商适配（OpenAI / Anthropic / DeepSeek / Qwen / Kimi / GLM / Gemini / Grok / Custom）
├── routers/            REST API（15 个路由模块）
├── services/           业务逻辑层
├── storage/            文件系统存储（YAML / Markdown / JSONL）
└── data/               项目数据目录（Git-Native）
```

### 数据存储结构

```
data/{project_id}/
├── project.yaml          项目元数据
├── cards/                设定卡片（角色、世界观、文风）
│   ├── character_001.yaml
│   └── worldview_001.yaml
├── canon/                动态事实表
│   └── facts.jsonl
├── drafts/               章节草稿
│   ├── .chapter_order
│   ├── chapter_001.md
│   └── chapter_002.md
└── sessions/             会话历史
    └── session_001.jsonl
```

---

## 技术栈

| 层 | 技术 |
| :--- | :--- |
| **前端** | React 18, Vite 5, TypeScript, TailwindCSS v3, SWR, Framer Motion, Lucide React |
| **后端** | FastAPI, Pydantic v2, Uvicorn, WebSocket, aiofiles |
| **LLM** | OpenAI SDK, Anthropic SDK（支持 9 个提供商动态切换） |
| **存储** | 文件系统（YAML / Markdown / JSONL），Git-Native 设计 |
| **打包** | PyInstaller（单目录模式，含前端构建产物） |

---

## 快速上手

### 方式一：下载 Release（推荐）

无需安装 Python 或 Node.js，开箱即用。

1. 前往 [Releases](https://github.com/unitagain/WenShape/releases) 下载最新版本 `WenShape_vX.X.X.zip`
2. 解压到任意目录
3. 双击运行 `WenShape.exe`，浏览器自动打开
4. 在 **设置 → 智能体配置** 中填入 API Key（支持 OpenAI / Anthropic / DeepSeek 等，也可选 Mock 模式体验）
5. 创建项目，开始写作

### 方式二：从源码运行

**环境要求**：Python 3.10+, Node.js 18+

```bash
# 克隆仓库
git clone https://github.com/unitagain/WenShape.git
cd WenShape-main

# Windows 一键启动
start.bat

# macOS / Linux
./start.sh
```

启动脚本自动完成依赖安装、端口检测（默认后端 8000，前端 3000，冲突时自动递增）和服务启动。

**手动启动**：

```bash
# 终端 1 — 后端
cd backend
pip install -r requirements.txt
python -m app.main

# 终端 2 — 前端
cd frontend
npm install
npm run dev
```

访问地址以启动日志输出为准。后端提供 Swagger 文档：`http://localhost:8000/docs`

### 配置

复制 `backend/.env.example` 为 `backend/.env`，填入 API Key：

```env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
DEEPSEEK_API_KEY=...
```

可在 `backend/config.yaml` 中为不同模块指定 LLM 提供商和参数：

```yaml
agents:
  archivist:
    provider: openai       # 档案员：精确性优先
    temperature: 0.3
  writer:
    provider: anthropic    # 撰稿人：创意性优先
    temperature: 0.7
  editor:
    provider: anthropic
    temperature: 0.5
```

---

## 使用指南

下面以“从 0 到 1 写完一章”为例，介绍 WenShape 的推荐使用流程（偏工程化、可回溯、可控）。

### 1）先配置模型卡片（LLM Profiles）
在 **设置 → 智能体配置** 中配置你的模型卡片（Profile），并为不同智能体选择合适的模型：
- **主笔（Writer）**：负责写作与续写（更偏创意与流畅度）。
- **档案员（Archivist）**：负责分析、提取事实与摘要、生成卡片等（更偏准确与结构化）。

建议：将 Writer/Editor 与 Archivist 使用不同的模型/温度策略，以平衡创意与可靠性。

### 2）完善设定卡（角色 / 世界观 / 文风）
在左侧 **设定卡片** 面板中维护你的长期设定资产：
- **角色卡 / 世界观卡**：可用于人物、地点、组织、体系、规则等。自由描述即可，但“结构化描述”通常效果更好。
- **星级（重要程度）**：影响被检索/注入上下文的优先级。例如主角设为 **三星**，可显著提高每次写作时被读取的概率，即便指令未显式提及。
- **文风卡（Style）**：你可以手填规则，也可以粘贴一段你希望模仿的样本文本，点击“提炼/提取”，让系统自动总结可执行的文风约束。

### 3）新建章节并开始写作（Writer）
在左侧 **资源管理器** 中新建章节（编号可不必手动管理），然后在右侧选择 **主笔** 输入本章目标与剧情走向。

指令越具体，越能降低“幻觉”和设定漂移。推荐包含：本章目标、关键事件、关键人物动机、必须出现/禁止出现的元素等。

### 4）需要修改就用编辑（Editor），并尽量提供定位
主笔生成草稿后，你可以切到 **编辑**：
- **快速 / 完整**：快速偏复用既有记忆；完整会重新做更充分的分析与上下文构建，通常更稳但更慢。
- **选区编辑（推荐）**：先用鼠标选中需要修改的几行/几段内容再提交指令，可显著提高命中率与可控性。
- 若不选区，建议在指令中给出大致方位（例如“针对开头/结尾/第 N 段/某段情节”）。
- 修改完成后会展示 Diff（红/绿块）。你可以逐块 **采纳/拒绝**，最后点击应用已采纳改动。

### 5）写完一章后：分析并保存（Archivist）
章节完成后点击右上角 **分析并保存**：
- 档案员会生成 **摘要、事实（Canon）、时间线、角色状态、卡片提案** 等，并写入“事实全典”。
- 后续写作时，主笔会读取这些资产理解“之前发生了什么”，从而降低前后矛盾。
- 你也可以在“事实全典”中手动新增/修订事实与摘要，作为长期一致性的“真值源”。

### 6）同人创作：导入设定资产
如果你做同人写作，可在 **同人创作** 页面：
- 通过搜索词条导入信息（第一个搜索框为萌娘百科检索）；
- 或粘贴目标页面 URL 进行解析（第二个输入框）；
- 勾选你需要的角色/设定，一键提取为卡片，随后可在写作中直接复用。

经验建议：同人提取后的卡片建议做一次人工精简与结构化整理（尤其是关系、能力、禁忌与世界规则），后续写作会更稳。

---

## 贡献

欢迎任何形式的贡献——Bug 报告、功能建议、代码提交、文档改进、国际化翻译、UI/UX 优化。

### 贡献流程

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 提交变更：`git commit -m "feat: description"`
4. 推送并创建 Pull Request

### PR 规范

- 标题格式：`feat|fix|docs|refactor: 简要描述`
- 确保代码可正常运行（后端无语法错误，前端 `npm run build` 通过）
- 涉及 UI 变更请附截图

---

## 许可协议

本项目采用 [PolyForm Noncommercial License 1.0.0](./LICENSE)。

- **允许**：个人非商业使用、学习、研究、修改
- **禁止**：任何形式的商业用途（包括企业内部使用）

商业授权请联系：[1467673018@qq.com](mailto:1467673018@qq.com)

---

<div align="center">
  <br />
  <p><strong>如果你正在使用文枢创作，欢迎把体验与反馈告诉我们。</strong></p>
  <p>你的一条 Issue、一次 PR，甚至一句建议，都可能让它变得更好。</p>
  <p>如果这个项目对你有帮助，点一个 Star 也是很大的鼓励。</p>
  <p><em>Let the story unfold.</em></p>
</div>
