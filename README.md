# WenShape

面向长篇小说创作的多智能体写作系统。

WenShape 的目标不是让模型一次性写完整本书，而是通过可编排 Agent、结构化设定资产、章节级事实沉淀与上下文预算控制，让长篇创作过程更稳定、可控、可回溯。

## 核心能力

- 多角色写作链路：`Archivist`、`Writer`、`Editor` 在编排器控制下协同工作。
- 长篇一致性维护：设定卡、章节摘要、事实百科、角色状态、分卷摘要统一沉淀。
- 可控编辑：支持选区编辑、整章编辑、Diff 预览与局部采纳。
- 同人导入：支持从百科和网页抽取信息，生成可继续编辑的设定卡。
- 多供应商模型：支持 OpenAI 兼容接口及多家真实模型服务商。
- Git 友好存储：项目数据以 YAML、Markdown、JSONL 等纯文本格式保存。

## 技术栈

- 前端：React 18、Vite、TypeScript、SWR、Tailwind CSS
- 后端：FastAPI、Pydantic v2、WebSocket
- 模型网关：统一 Provider 适配层 + 可配置 Profile
- 存储：文件系统 + 结构化文本资产

## 项目结构

```text
frontend/
  src/
    components/
    pages/
    hooks/
    i18n/

backend/
  app/
    agents/
    orchestrator/
    context_engine/
    llm_gateway/
    routers/
    services/
    storage/
```

## 快速开始

### 方式一：一键启动

要求：

- Python 3.10+
- Node.js 18+

```bash
git clone https://github.com/unitagain/WenShape.git
cd WenShape-main
python start.py
```

### 方式二：手动启动

后端：

```bash
cd backend
pip install -r requirements.txt
python -m app.main
```

前端：

```bash
cd frontend
npm install
npm run dev
```

默认地址：

- 前端开发地址：`http://localhost:3000`
- 后端开发地址：`http://localhost:8000`
- API 文档：`http://localhost:8000/docs`

## 配置

复制 `backend/.env.example` 为 `backend/.env`，填入你的模型服务密钥：

```env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=...
DEEPSEEK_API_KEY=...
```

运行期配置位于 `backend/config.yaml`，可调整：

- 会话轮次
- 上下文预算
- 各 Agent 的模型供应商与参数
- 其他后端行为选项

## 开发与质量

前端：

```bash
cd frontend
npm run lint
npm run typecheck
npm run build
```

后端：

```bash
cd backend
python -m ruff check app tests
pytest -q
python -m compileall app
```

仓库内置质量脚本：

```bash
python scripts/check_encoding.py
python scripts/check_generated_assets.py
python scripts/check_requirements_sync.py
python scripts/check_large_files.py
python scripts/check_bilingual_docstrings.py
```

## 构建产物边界

以下目录视为构建产物，不应作为源码提交：

- `dist/`
- `build/`
- `frontend/dist/`
- `frontend/build/`
- `backend/static/`

可使用：

```bash
python scripts/clean_generated_dirs.py
python scripts/clean_generated_dirs.py --apply
```

## 依赖管理约定

后端依赖采用单一事实源策略：

- `backend/requirements.lock` 是唯一依赖事实源，并固定 pin 版本。
- `backend/requirements.txt` 仅作为兼容入口，固定包含 `-r requirements.lock`。

## 编码与注释规范

- 全仓统一 UTF-8。
- 后端 `backend/app` 模块级注释统一中英双语。
- 使用 `.editorconfig` 约束基础文本格式。

## 贡献

欢迎提交：

- Bug 修复
- 文档与国际化改进
- UI/UX 优化
- 测试补充
- 架构重构与性能优化

建议提交前执行：

```bash
cd backend && pytest -q
cd frontend && npm run lint && npm run typecheck && npm run build
```

## 许可证

本项目采用 `PolyForm Noncommercial License 1.0.0`，详见 `LICENSE`。
