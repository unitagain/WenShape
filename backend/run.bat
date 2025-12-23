@echo off
REM NOVIX Backend Startup Script for Windows

set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8

echo ========================================
echo   NOVIX Backend Server
echo ========================================
echo.

REM Check Python installation
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH.
    echo.
    echo Please install Python 3.10+ from:
    echo   https://www.python.org/downloads/
    echo.
    echo IMPORTANT: During installation, check "Add python.exe to PATH"
    echo.
    pause
    exit /b 1
)

REM Check if virtual environment exists
if not exist "venv\" (
    echo [1/4] Creating virtual environment...
    python -m venv venv
    if errorlevel 1 (
        echo ERROR: Failed to create virtual environment.
        echo Please make sure Python 3.10+ is installed correctly.
        pause
        exit /b 1
    )
)

echo [2/4] Activating virtual environment...
call venv\Scripts\activate

echo [3/4] Upgrading pip and installing dependencies...
python -m pip install --upgrade pip -q
python -m pip install -r requirements.txt -q
if errorlevel 1 (
    echo.
    echo ERROR: Dependency installation failed.
    echo Try running: python -m pip install -r requirements.txt
    echo to see detailed error messages.
    pause
    exit /b 1
)

REM Check if .env exists
if not exist ".env" (
    echo.
    echo [!] .env file not found. Copying from .env.example...
    copy .env.example .env >nul
    echo [!] Please edit .env file and add your API keys!
    echo     Or use NOVIX_LLM_PROVIDER=mock for demo mode.
    echo.
    pause
)

REM Start server
echo.
echo [4/4] Starting server...
echo.
echo   Frontend: http://localhost:3000
echo   Backend:  http://localhost:8000
echo   API Docs: http://localhost:8000/docs
echo.

python -m app.main

pause
