@echo off
REM NOVIX Backend Startup Script for Windows

set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8

echo ========================================
echo   NOVIX Backend Server
echo ========================================
echo.

REM Check if virtual environment exists
if not exist "venv\" (
    echo [1/3] Creating virtual environment...
    python -m venv venv
    if errorlevel 1 (
        echo ERROR: Failed to create virtual environment.
        echo Please make sure Python 3.10+ is installed.
        pause
        exit /b 1
    )
)

echo [1/3] Activating virtual environment...
call venv\Scripts\activate

echo [2/3] Installing dependencies...
python -m pip install -r requirements.txt -q
if errorlevel 1 (
    echo.
    echo ERROR: Dependency installation failed.
    pause
    exit /b 1
)

REM Check if .env exists
if not exist ".env" (
    echo.
    echo [!] .env file not found. Copying from .env.example...
    copy .env.example .env >nul
    echo [!] Please edit .env file and add your API keys!
    echo.
    pause
)

REM Start server
echo.
echo [3/3] Starting server...
echo.
echo   Frontend: http://localhost:3000
echo   Backend:  http://localhost:8000
echo   API Docs: http://localhost:8000/docs
echo.

python -m app.main

pause
