@echo off
setlocal
chcp 65001 >nul
echo ========================================
echo    WenShape One-Click Start
echo ========================================
echo.

python --version >nul 2>&1
if errorlevel 1 goto :python_missing

python "%~dp0start.py"
exit /b 0

:python_missing
echo [Error] Python not found. Please install Python 3.10+.
echo Download: https://www.python.org/downloads/
echo.
pause
exit /b 1
