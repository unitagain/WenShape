@echo off
REM WenShape Frontend Startup Script for Windows

REM Ensure working directory is this script's directory (robust for "frontend\\run.bat" called from repo root)
cd /d %~dp0

setlocal EnableExtensions

echo ========================================
echo   WenShape Frontend
echo ========================================
echo.

REM Check Node.js installation
node --version >nul 2>&1
if errorlevel 1 goto :node_missing

REM Check if node_modules exists
if not exist "node_modules\" goto :install_deps
goto :start_dev

:install_deps
echo [1/2] Installing dependencies...
call npm install
if errorlevel 1 goto :npm_failed

:start_dev
echo [2/2] Starting development server...
echo.
if "%VITE_DEV_PORT%"=="" set "VITE_DEV_PORT=%WENSHAPE_FRONTEND_PORT%"
if "%VITE_DEV_PORT%"=="" set "VITE_DEV_PORT=3000"
if "%VITE_BACKEND_PORT%"=="" set "VITE_BACKEND_PORT=%WENSHAPE_BACKEND_PORT%"
if "%VITE_BACKEND_PORT%"=="" set "VITE_BACKEND_PORT=8000"
if "%VITE_BACKEND_URL%"=="" set "VITE_BACKEND_URL=http://localhost:%VITE_BACKEND_PORT%"
echo   Frontend: http://localhost:%VITE_DEV_PORT%
echo   Backend:  %VITE_BACKEND_URL% (make sure it is running)
echo.

call npm run dev

exit /b 0

:node_missing
echo ERROR: Node.js is not installed or not in PATH.
echo.
echo Please install Node.js 18+ from:
echo   https://nodejs.org/
echo.
echo Download the LTS version and run the installer.
echo.
pause
exit /b 1

:npm_failed
echo.
echo ERROR: npm install failed.
pause
exit /b 1
