<p align="center">
  <img src="./docs/img/logo.svg" alt="WenShape Logo" width="420" />
</p>

<p align="center">
  <strong>A deep context-aware agentic writing system</strong>
</p>

<p align="center">
  <em>Let the story unfold</em>
</p>

<p align="center">
  <a href="./README.md">中文 README</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React%20%2B%20Vite-4B6B88?style=flat-square" alt="Frontend Badge" />
  <img src="https://img.shields.io/badge/FastAPI-3F7C85?style=flat-square" alt="Backend Badge" />
  <img src="https://img.shields.io/badge/YAML%20%2F%20Markdown%20%2F%20JSONL-7A6F5A?style=flat-square" alt="Storage Badge" />
  <img src="https://img.shields.io/badge/Multi--Provider%20LLM-55606E?style=flat-square" alt="LLM Badge" />
</p>

> WenShape focuses not only on generation, but also on consistency, traceability, and maintainability in long-form writing.

## 🌿 What is WenShape

WenShape is an agentic writing system built for mid- to long-form fiction. Instead of treating the model as a black box that writes an entire book in one pass, it breaks writing into visible, maintainable, and traceable modules: volume and chapter structure, character and world cards, chapter summaries, fact storage, editing review, fanfiction import, and model configuration.

The frontend provides a clear and stable writing workspace, while the backend organizes the creative workflow through `orchestrator + agents + context_engine + storage`. Project data is stored in plain-text formats such as YAML, Markdown, and JSONL, making it well suited for version control and long-term maintenance.

## 🚀 Quick Start

### 1. Run from source

Requirements:

- Python 3.10+
- Node.js 18+

Start directly from the project root:

```bash
cd WenShape-main
start.bat
```

`start.bat` calls the root-level `start.py`, checks the Python / Node.js environment, starts both backend and frontend services, and prepares the basic local configuration on first run.

### 2. One-click Windows release

If you just want to use WenShape without setting up a development environment:

1. Download the latest Windows package from `Releases`
2. Extract it and double-click `WenShape.exe`
3. No separate Python or Node.js installation is required; it will start and open the browser automatically

The release package is built by `build_release.py` at the project root. The output is placed in `dist/WenShape/`, together with `config.yaml`, `.env`, `data/`, and the required static assets.

## ✨ Why WenShape

### 1. Clear volume and chapter structure

WenShape does not push an entire book into a single conversation flow. Instead, it explicitly maintains a writing structure of `volume -> chapter -> draft/summary`. The project stores data in dedicated files such as `volumes/*.yaml`, `summaries/*_summary.yaml`, `drafts/<chapter>/final.md`, and `scene_brief.yaml`, while chapter order is persisted through `order_index`.

This makes the writing process easier to keep in order and within clear boundaries. You can plan by volume, write chapter by chapter, refresh summaries independently, and still preserve a stable order after batch operations. The volume tree and chapter management UI in the frontend map directly to this structure.

### 2. A card system for characters, worldbuilding, and style

WenShape separates long-lived project knowledge into three core card types: character cards, world cards, and style cards, stored in `cards/characters/*.yaml`, `cards/world/*.yaml`, and `cards/style.yaml`. This keeps project settings out of transient chat history and turns them into maintainable, searchable, and reusable assets.

World cards now follow a description-first structure: new data is centered on `description`, while legacy `rules` / `immutable` fields are still read and merged into the description text for backward compatibility. This keeps old projects usable while simplifying the current data model.

### 3. A distance-aware fact and summary system for reducing drift

WenShape does not simply feed the entire context back into the model. Instead, it selectively injects facts, summaries, cards, and chapter bindings. Facts are primarily stored in `canon/facts.jsonl`, chapter and volume summaries are stored as YAML, and the evidence index is built by `evidence_service`.

During retrieval, the system combines BM25, entity boosting, chapter bindings, and fact distance decay to select relevant context. In `select_engine`, facts use logarithmic chapter distance decay: facts introduced closer to the current chapter receive higher weight, while older but still important world facts are not discarded outright. This is one of the foundations that helps WenShape keep long-form context stable.

### 4. Fanfiction workflow for quickly building the original world context

The fanfiction workflow is not just "paste a long wiki article into a textbox". It is a four-step flow of search, preview, extraction, and proposal generation. In the current implementation, `search_service` supports sources such as Moegirl, Wikipedia, and Fandom; `crawler_service` handles body extraction, link recognition, and multi-path fallback; and the `fanfiction` router sends the result to an agent that generates character / world card proposals.

You can either search for wiki entries first or paste any `http/https` page URL directly for preview and extraction. Extracted results are not written into the project immediately. They enter WenShape as proposals first, and you decide whether to keep, revise, or discard them. This makes the workflow more reliable and better suited to fanfiction research and cleanup.

### 5. Support for major model providers and third-party APIs

WenShape keeps provider logic out of scattered UI and business code by routing model access through `llm_gateway`. The current configuration UI includes built-in support for OpenAI, Anthropic, DeepSeek, Gemini, Qwen, Wenxin, AI Studio, and custom OpenAI-compatible APIs.

You can use official providers directly, or connect through third-party aggregators, private relay layers, or local compatible gateways. The frontend focuses on configuration cards and model selection, while the backend handles provider adapters and a unified invocation protocol. The module boundary stays clear, which also makes new provider support easier to extend cleanly.

## 🧭 Project Structure

```text
WenShape-main/
├─ start.bat                      # Windows one-click entry point
├─ start.py                       # Local launcher that checks env and starts services
├─ build_release.py               # Windows release packaging script
├─ docs/img/logo.svg              # Project logo
├─ frontend/
│  └─ src/
│     ├─ pages/                   # Page-level entries such as writing and project pages
│     ├─ components/              # Business components and shared UI
│     ├─ hooks/                   # Reusable frontend logic
│     ├─ context/                 # Global state and context
│     ├─ lib/ utils/              # API helpers, utilities, adapters
│     └─ i18n/                    # Text resources and localization
└─ backend/
   └─ app/
      ├─ routers/                 # HTTP / WebSocket route entry points
      ├─ orchestrator/            # Multi-agent orchestration flow
      ├─ agents/                  # Writer / Editor / Archivist and others
      ├─ context_engine/          # Context selection, budgeting, ranking
      ├─ llm_gateway/             # Provider adapters and unified model calls
      ├─ services/                # Summaries, evidence, crawling, bindings, etc.
      ├─ storage/                 # YAML / Markdown / JSONL storage layer
      ├─ schemas/                 # Pydantic data models
      └─ prompt_templates/        # Prompt templates
```

### Suggested reading order

If you plan to maintain the project, this reading order works well:

1. `frontend/src/pages/WritingSession.jsx`: understand the main workspace users actually interact with
2. `backend/app/routers/session.py`: see how frontend actions enter backend APIs
3. `backend/app/orchestrator/orchestrator.py`: understand how writing, editing, and analysis flows are orchestrated
4. `backend/app/agents/`: inspect the boundaries of Writer, Editor, Archivist, and related agents
5. `backend/app/context_engine/` and `backend/app/services/`: understand context selection, fact retrieval, chapter bindings, and fanfiction ingestion
6. `backend/app/storage/`: learn how project data is persisted and how backward compatibility is handled

This path is usually more efficient than jumping across the repository through global search alone, and it makes module responsibilities easier to see.

## 🤝 Contributing

Contributions are welcome through issues, feature proposals, documentation updates, or pull requests:

- Improve or expand the documentation
- Report bugs or suggest features
- Refine interactions, copy, visuals, and overall UX
- Add tests, fix edge cases, and improve architecture
- Submit PRs that help keep the project stable and clear

Every piece of feedback or contribution helps improve the project.  
If WenShape is useful to you, a Star ⭐ is always appreciated.

## 📄 License

This project is licensed under `PolyForm Noncommercial License 1.0.0`.

See `LICENSE` for details.
