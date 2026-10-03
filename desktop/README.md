# WenShape Desktop Shell

This directory contains the Electron desktop shell for WenShape.

For current optimization and acceptance status, see the workspace `plan.md` and
[the quality review](../docs/optimization-quality-review-2026-10-03.md).

Use Node.js 22 LTS (at least 22.12) for the complete frontend and desktop build,
and an isolated Python 3.12 environment for the backend sidecar. Run backend
engineering checks with that environment's Python; child checks use the same
interpreter. Runtime dependencies come from `backend/requirements.runtime.txt`.

## Responsibilities

- `config/`
  - shell manifest and release metadata inputs
- `main/`
  - Electron main-process code
- `preload/`
  - controlled renderer bridge
- `resources/`
  - icon and packaging assets
- `scripts/`
  - development, doctor, and release build scripts

## Main Commands

```bash
cd desktop
npm run doctor
npm run dev
npm run build:sidecar:isolated
npm run make:windows
npm run make:macos:x64
```

## Phase 4 Notes

Phase 4 focuses on packaging and delivery readiness:

- frontend static assets are synced into `backend/static`
- Python sidecar is built with PyInstaller
- Electron Forge consumes the packaged sidecar as an extra resource
- Windows releases are generated as WiX-based `.msi` installers via `scripts/build-windows-msi.mjs`
- release artifacts are emitted into `desktop/.artifacts/releases`

After packaging, run `backend/scripts/package_runtime_smoke.py --sidecar <packaged-executable> --output <report.json>`
with the backend development environment. It uses a temporary data directory and
does not call a model. Packaging and smoke checks do not establish installer,
signing, update, or manual writing-workflow acceptance.
