#!/usr/bin/env bash
# WenShape Backend Startup Script for Linux/Mac

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8

echo "========================================"
echo "  WenShape Backend Server"
echo "========================================"
echo

if ! python3 --version >/dev/null 2>&1; then
    echo "ERROR: Python 3 is not installed or not in PATH."
    exit 1
fi

if [ ! -d "venv" ]; then
    echo "[INFO] Virtual environment not found. Creating..."
    python3 -m venv "venv"
fi

# shellcheck disable=SC1091
source "venv/bin/activate"

echo "[1/3] Checking dependencies..."
if python "scripts/check_requirements_installed.py" "requirements.txt" >/dev/null 2>&1; then
    echo "[OK] Pinned backend dependencies already installed."
else
    echo "[INFO] Missing or mismatched packages detected. Installing pinned dependencies..."
    if ! python -m pip install -r requirements.txt --disable-pip-version-check; then
        echo
        echo "ERROR: Dependency installation failed."
        echo "This usually means your network/proxy cannot reach PyPI, or some pinned wheel is temporarily unavailable."
        echo "If dependencies are already installed, rerun backend/run.sh and the offline checker will skip pip."
        exit 1
    fi
fi

if [ ! -f ".env" ]; then
    echo
    echo "[!] .env file not found. Creating default backend config (.env)..."
    cat > ".env" <<'EOF'
# Auto-generated on first run
HOST=127.0.0.1
PORT=8000
DEBUG=True

# Configure provider API keys below. See .env.example
EOF
    echo "[!] Created: $SCRIPT_DIR/.env"
    echo "[!] Please edit .env and fill real provider API keys before using writing features."
fi

echo
echo "[2/3] Starting server..."
BACKEND_PORT="${PORT:-${WENSHAPE_BACKEND_PORT:-8000}}"
export WENSHAPE_AUTO_PORT="${WENSHAPE_AUTO_PORT:-1}"
echo "  Backend:  http://localhost:${BACKEND_PORT}"
echo "  API Docs: http://localhost:${BACKEND_PORT}/docs"
echo

echo "[3/3] Server running..."
python -m app.main
