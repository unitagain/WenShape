@echo off
REM NOVIX Frontend Startup Script for Windows

echo ========================================
echo   NOVIX Frontend
echo ========================================
echo.

REM Check if node_modules exists
if not exist "node_modules\" (
    echo [1/2] Installing dependencies...
    npm install
    if errorlevel 1 (
        echo.
        echo ERROR: npm install failed.
        echo Please make sure Node.js 18+ is installed.
        pause
        exit /b 1
    )
)

echo [2/2] Starting development server...
echo.
echo   Frontend: http://localhost:3000
echo   Backend:  http://localhost:8000 (make sure it is running)
echo.

npm run dev
