# WenShape 启动与验证指南（单文件版）

本文件合并了原 `GETTING_STARTED.md` 与 `QUICKSTART.md`，目标是让你**用最少的步骤**完成：
1) 启动前后端；2) 配置 LLM；3) 用 API 做一轮“可重复”的自检验证。

---

## 0. 你需要准备什么（最低要求）

- **Python 3.10–3.12**（推荐独立 Python 3.12 环境）
- **Node.js 22 LTS**（至少 22.12，涵盖前端测试依赖）
- 推荐：使用终端运行命令（Windows PowerShell / macOS Terminal / Linux Bash）

---

## 1. 一键启动（推荐）

在 `WenShape-main/` 目录下执行：

### 1.1 所有平台通用（最稳）

```bash
python start.py
```

该脚本会：
- 自动选择可用端口（默认后端 8000 / 前端 3000，若被占用会向后寻找）
- 启动后端（FastAPI）与前端（Vite dev server）

### 1.2 Windows（双击/新窗口日志）

双击 `start.bat`，或在终端运行：

```bat
start.bat
```

### 1.3 macOS / Linux（可见日志，打开独立终端）

```bash
bash start.sh
```

说明：
- macOS 优先使用 `osascript` 打开 Terminal 并执行命令；
- Linux 会尝试 `gnome-terminal`，其次 `xterm`。

---

## 2. 手动启动（当你需要更可控的日志/调试）

### 2.1 后端（FastAPI）

```bash
cd backend
python -m pip install -r requirements.txt
python -m app.main
```

默认地址：
- API：`http://localhost:8000`
- Swagger：`http://localhost:8000/docs`

### 2.2 前端（Vite）

另开一个终端：

```bash
cd frontend
npm install
npm run dev
```

默认地址：
- UI：`http://localhost:3000`

---

## 3. LLM 配置（两层配置，按需选择）

### 3.1 必需：先创建 LLM Profile 并完成 Agent 分配

当前后端的模型配置是**“Profile + Assignment”**机制：

- Profiles：`/config/llm/profiles`（持久化在 `data/llm_profiles.json`）
- Assignments：`/config/llm/assignments`（持久化在 `data/agent_assignments.json`）

你可以在前端「LLM 配置」面板里完成这两步；也可以用 API 调用完成（见下文）。

如果未完成分配，运行写作/分析时会报错类似：`No LLM profile assigned for agent 'writer'`。

### 3.2 可选：API Key 放在 `backend/.env`（用于“首次迁移/快速初始化”）

在 `WenShape-main/backend/` 下复制示例文件：

**macOS / Linux**

```bash
cp .env.example .env
```

**Windows（PowerShell / CMD）**

```bat
copy .env.example .env
```

然后编辑 `backend/.env`，填入你使用的提供商 Key（示例）：

```env
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
DEEPSEEK_API_KEY=...
```

说明：
- 如果 `data/llm_profiles.json` 为空，后端会尝试从 `.env` 里读取 key，自动生成 “Legacy *” profiles 并默认分配给 `archivist/writer/editor`（便于首次启动）。
- 一旦你在 UI 里创建了新的 profiles/assignments，系统将以它们为准。

---

## 4. 端口与代理（避免“明明启动了却连不上”）

- 后端端口优先级：`PORT` > `WENSHAPE_BACKEND_PORT`（脚本会同步两者）
- 前端端口优先级：`VITE_DEV_PORT` > `WENSHAPE_FRONTEND_PORT`
- 前端代理后端（可选）：`VITE_BACKEND_URL=http://localhost:8000`

注意：
- 一键启动脚本可能会**自动切换端口**（端口被占用时），请以启动日志输出为准。

---

## 5. API 自检（可重复的回归式验证）

下面的命令用于验证：项目创建、卡片创建、会话启动，确保后端路由与存储链路都正常。

### 5.1 创建项目

建议先创建项目，再通过 “列出项目” 获取真实 `{project_id}`（项目 ID 会做规范化处理）。

**macOS / Linux（bash/zsh）**

```bash
curl -X POST "http://localhost:8000/projects" \
  -H "Content-Type: application/json" \
  -d '{"name":"测试小说","description":"这是一个测试项目"}'
```

**Windows（PowerShell，注意使用 `curl.exe`）**

```powershell
curl.exe -X POST "http://localhost:8000/projects" `
  -H "Content-Type: application/json" `
  -d "{\"name\":\"测试小说\",\"description\":\"这是一个测试项目\"}"
```

### 5.2 列出项目（获取 `project_id`）

```bash
curl "http://localhost:8000/projects"
```

### 5.3 创建角色卡

```bash
curl -X POST "http://localhost:8000/projects/{project_id}/cards/characters" \
  -H "Content-Type: application/json" \
  -d '{"name":"张三","description":"主角。示例：外表与性格可在此简述。","aliases":[],"stars":3}'
```

说明：当前角色卡最少需要 `name` 与 `description` 两个字段。

### 5.4 启动写作会话

```bash
curl -X POST "http://localhost:8000/projects/{project_id}/session/start" \
  -H "Content-Type: application/json" \
  -d '{"chapter":"ch01","chapter_title":"开始","chapter_goal":"介绍主角张三的日常生活与困境","target_word_count":2000,"character_names":["张三"]}'
```

### 5.5（可选）用 API 配置 LLM Profiles / Assignments（无前端也能用）

如果你只跑后端（没有前端 UI），可以用下面这组接口配置模型：

- `GET /config/llm/providers_meta`：查看可选 provider 与字段
- `POST /config/llm/profiles`：创建/更新 profile
- `POST /config/llm/assignments`：把 profile 分配给 `archivist/writer/editor`

---

## 6. 数据存储位置（你应该在哪里找输出）

默认情况下，项目数据会写到 `WenShape-main/data/` 下（每个项目一个目录）。

常见结构（示意）：

```
data/
  {project_id}/
    project.yaml
    cards/
      characters/
      world/
    drafts/
    summaries/
    canon/
    traces/
```

---

## 7. 常见问题（按症状排查）

### 7.1 后端启动失败

- 检查 Python 版本：`python --version`
- 依赖是否安装：`python -m pip install -r backend/requirements.txt`
- 端口是否被占用：换端口或使用一键启动脚本自动选端口

### 7.2 前端能打开，但功能请求失败

- 打开浏览器控制台（F12）查看请求是否命中正确的后端地址
- 确认后端端口与 `VITE_BACKEND_URL` 一致

### 7.3 你不确定应该怎么配模型

- 先在前端「LLM 配置」里创建一个 profile，并把它分配给 `archivist/writer/editor`；
- 再逐步调整 model/temperature/base_url 等参数，每次只改一个变量便于定位问题。

---

## 8. 获取帮助

- API 文档：`http://localhost:8000/docs`
- 提交 Issue：`https://github.com/unitagain/WenShape/issues`
