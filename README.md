<p align="center">
  <img src="./docs/img/logo.svg" alt="文枢 Logo" width="420" />
</p>

<p align="center">
  <strong>深度上下文感知的智能体创作系统</strong>
</p>

<p align="center">
  <em>Let the story unfold · 让故事谱写</em>
</p>

<p align="center">
  <a href="./README.en.md">English README</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React%20%2B%20Vite-4B6B88?style=flat-square" alt="Frontend Badge" />
  <img src="https://img.shields.io/badge/FastAPI-3F7C85?style=flat-square" alt="Backend Badge" />
  <img src="https://img.shields.io/badge/YAML%20%2F%20Markdown%20%2F%20JSONL-7A6F5A?style=flat-square" alt="Storage Badge" />
  <img src="https://img.shields.io/badge/Multi--Provider%20LLM-55606E?style=flat-square" alt="LLM Badge" />
</p>

> 文枢关注的不只是生成结果，也包括长篇写作中的一致性、回溯性与可维护性。

## 🌿 文枢是什么

文枢是一个面向中长篇小说创作的智能体系统。它不把模型当成一次性写完整本书的黑盒，而是把写作拆成多个可见、可维护、可回溯的模块: 分卷与章节结构、人物与世界观卡片、章节摘要、事实库、编辑审阅、同人导入、模型配置。

前端提供清晰稳定的写作工作台，后端通过 `orchestrator + agents + context_engine + storage` 组织创作流程。项目数据落在 YAML、Markdown、JSONL 等纯文本格式中，适合版本管理，也适合长期维护。

## 🚀 快速开始

### 1. 源码版部署

前置环境:

- Python 3.10+
- Node.js 18+

在项目根目录直接启动:

```bash
cd WenShape-main
start.bat
```

`start.bat` 会调用根目录的 `start.py`，自动检查 Python / Node.js 环境，拉起前后端服务，并在首次运行时补齐本地开发需要的基础配置。

### 2. Windows Release 一键启用

如果你只是想直接使用文枢，而不是折腾环境:

1. 前往仓库的 `Releases` 页面下载最新 Windows 发布包
2. 解压后双击 `WenShape.exe`
3. 无需额外安装 Python 或 Node.js，即可一键启动并自动打开浏览器进入使用界面

发布包由根目录的 `build_release.py` 构建，产物位于 `dist/WenShape/`，运行所需的 `config.yaml`、`.env`、`data/` 和静态资源也会一并准备好。

## ✨ 文枢的特点优势

### 1. 清晰的分卷章节结构

文枢不是把整本书塞进单一对话流里，而是显式维护“卷 -> 章节 -> 草稿/摘要”的写作结构。项目中有独立的 `volumes/*.yaml`、`summaries/*_summary.yaml`、`drafts/<chapter>/final.md` 与 `scene_brief.yaml`，章节顺序还会通过 `order_index` 持久化管理。

这让写作过程更容易保持顺序和边界。你可以按卷规划、按章推进、单独刷新摘要，也可以在批量处理后保留稳定顺序。前端的卷树和章节管理界面，背后对应的正是这套结构化存储。

### 2. 卡片系统构建人物 / 世界观 / 文风设定集

文枢把长期设定资产拆成三类核心卡片: 人物卡、世界观卡、文风卡，分别落在 `cards/characters/*.yaml`、`cards/world/*.yaml` 和 `cards/style.yaml`。这让设定不再散落在聊天记录里，而是成为可维护、可检索、可复用的项目资产。

世界观卡已经采用 description-first 结构: 新数据以 `description` 为主，旧版本残留的 `rules` / `immutable` 字段仍会兼容读取并合并进描述文本。这样既保留了旧数据兼容性，也让新的结构更简洁。

### 3. 按距离索引的事实摘要系统，用于降低幻觉

文枢当前不是简单“把全部上下文喂给模型”，而是围绕事实、摘要、卡片和章节绑定做选择性注入。事实主存储在 `canon/facts.jsonl`，章节摘要与分卷摘要分别保存为 YAML，证据索引由 `evidence_service` 统一构建。

检索时会结合 BM25、实体增强、章节绑定与事实距离衰减来挑选相关上下文。其中 `select_engine` 对事实采用对数型 chapter distance decay: 越接近当前章节的事实权重越高，较远但仍重要的世界观事实也不会被直接丢弃。这套机制是文枢控制长篇上下文稳定性的基础之一。

### 4. 同人创作功能，通过百科和网页快速构建原作世界观

同人工作流不是“复制一大段百科文本进输入框”，而是包含搜索、预览、抓取、提案四个步骤。当前实现里，`search_service` 支持萌娘百科、Wikipedia、Fandom 等来源搜索，`crawler_service` 负责页面正文抽取、链接识别与多路回退，`fanfiction` 路由再把结果送入智能体生成角色 / 世界观卡片提案。

你既可以先搜索 Wiki 词条，也可以直接粘贴任意 `http/https` 页面地址进行预览和抽取。抽取结果不会直接写入项目，而是先以 proposal 的形式进入文枢，再由你决定保留、修改还是丢弃。这样更稳，也更适合同人创作中的整理与校正流程。

### 5. 支持主流模型供应商，同时兼容第三方 API

文枢的模型层不是把供应商逻辑散落在页面和业务代码里，而是通过 `llm_gateway` 统一抽象。当前配置页内置支持 OpenAI、Anthropic、DeepSeek、Gemini、Qwen 通义千问、Wenxin 文心一言、AI Studio 飞桨，以及自定义 OpenAI 兼容接口。

你可以直接使用主流官方服务，也可以接入第三方聚合平台、私有中转层或本地兼容网关。前端维护配置卡片与模型选择体验，后端维护 provider adapter 和统一调用协议，模块边界清楚，后续扩展新供应商也更容易保持整洁。

## 🧭 项目代码结构

```text
WenShape-main/
├─ start.bat                      # Windows 一键启动入口
├─ start.py                       # 本地开发启动器，检查环境并拉起前后端
├─ build_release.py               # Windows 发布构建脚本
├─ docs/img/logo.svg              # 项目标识
├─ frontend/
│  └─ src/
│     ├─ pages/                   # 页面级入口，如写作页、项目页
│     ├─ components/              # 业务组件与通用 UI
│     ├─ hooks/                   # 前端复用逻辑
│     ├─ context/                 # 全局状态与上下文
│     ├─ lib/ utils/              # API、工具函数、适配层
│     └─ i18n/                    # 文案与国际化资源
└─ backend/
   └─ app/
      ├─ routers/                 # HTTP / WebSocket 路由入口
      ├─ orchestrator/            # 多智能体编排主流程
      ├─ agents/                  # Writer / Editor / Archivist 等能力体
      ├─ context_engine/          # 上下文选择、预算与排序逻辑
      ├─ llm_gateway/             # 模型供应商适配与统一调用
      ├─ services/                # 摘要、证据、抓取、绑定等领域服务
      ├─ storage/                 # YAML / Markdown / JSONL 文件存储层
      ├─ schemas/                 # Pydantic 数据结构
      └─ prompt_templates/        # 提示词模板
```

### 推荐阅读顺序

如果你准备接手维护，建议按下面的顺序读代码:

1. `frontend/src/pages/WritingSession.jsx`: 先理解用户真正看到的主工作台
2. `backend/app/routers/session.py`: 再看前端动作如何进入后端接口
3. `backend/app/orchestrator/orchestrator.py`: 理解写作、编辑、分析等主流程如何被编排
4. `backend/app/agents/`: 查看 Writer、Editor、Archivist 等能力边界
5. `backend/app/context_engine/` 与 `backend/app/services/`: 理解上下文选择、事实检索、章节绑定、同人抓取等核心机制
6. `backend/app/storage/`: 最后掌握项目数据如何在文件系统中落地和兼容迁移

这样的阅读路线会比直接在仓库里全局跳转更高效，也更容易看清每个模块的职责。

## 🤝 协作与贡献

欢迎通过 issue、feature proposal、文档修订或 PR 参与协作:

- 查看并补充文档
- 提交 bug issue 或功能建议
- 改进交互、文案、视觉和使用体验
- 补充测试、修复边界问题、优化架构
- 提交 PR 一起把项目做得更稳、更强

每一次反馈和贡献，都会让它更完善一些。  
如果这个项目对你有帮助，欢迎点一颗 Star ⭐

## 📄 License

本项目采用 `PolyForm Noncommercial License 1.0.0`。

详细条款见 `LICENSE`。
