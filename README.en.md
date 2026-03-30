# WenShape

A multi-agent writing system for long-form fiction.

WenShape is designed to make novel writing more controllable and maintainable. Instead of treating the model as a single all-knowing chat box, it coordinates specialized agents, structured project assets, and chapter-level memory to reduce drift in long narratives.

## Highlights

- Multi-agent workflow driven by an orchestrator
- Structured canon management for facts, summaries, states, and volumes
- Controllable editing with selection editing and diff review
- Fanfiction import pipeline for extracting cards from public web pages
- Multiple real model providers through a unified gateway
- Git-friendly plain-text storage with YAML / Markdown / JSONL

## Tech Stack

- Frontend: React 18, Vite, TypeScript, SWR, Tailwind CSS
- Backend: FastAPI, Pydantic v2, WebSocket
- LLM layer: provider abstraction + configurable profiles
- Storage: filesystem-based structured assets

## Project Layout

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

## Quick Start

Requirements:

- Python 3.10+
- Node.js 18+

### Run with the launcher

```bash
git clone https://github.com/unitagain/WenShape.git
cd WenShape-main
python start.py
```

### Run manually

Backend:

```bash
cd backend
pip install -r requirements.txt
python -m app.main
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Default development endpoints:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8000`
- API docs: `http://localhost:8000/docs`

## Configuration

Copy `backend/.env.example` to `backend/.env` and fill in your provider keys.

Example:

```env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=...
DEEPSEEK_API_KEY=...
```

Runtime behavior is configured in `backend/config.yaml`, including:

- session limits
- context budgets
- provider/profile choices per agent
- other backend options

## Quality Checks

Frontend:

```bash
cd frontend
npm run lint
npm run typecheck
npm run build
```

Backend:

```bash
cd backend
python -m ruff check app tests
pytest -q
python ../scripts/check_requirements_sync.py
```

The repository also includes a GitHub Actions workflow for baseline CI validation.

Build asset boundary:

- Treat `frontend/dist` and `backend/static/assets` as generated outputs, not source files.
- Run `python scripts/check_generated_assets.py` locally to catch accidental tracking.

## Encoding

- The repository uses UTF-8 text files
- `.editorconfig` defines basic formatting defaults
- `scripts/check_encoding.py` can be used to scan for common mojibake patterns

## Contributing

Contributions are welcome, including:

- bug fixes
- documentation improvements
- i18n fixes
- UI/UX refinements
- tests and refactors

Before opening a PR, please run the local quality checks listed above.

## License

Licensed under `PolyForm Noncommercial License 1.0.0`.

See `LICENSE` for details.
