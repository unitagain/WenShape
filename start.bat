@echo off
chcp 65001 >nul
echo ========================================
echo    NOVIX 一键启动
echo ========================================
echo.

REM 检查 Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Python，请先安装 Python 3.10+
    echo 下载地址: https://www.python.org/downloads/
    echo.
    pause
    exit /b 1
)

REM 检查 Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js 18+
    echo 下载地址: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo [1/3] 启动后端服务...
start "NOVIX Backend" cmd /k "cd /d %~dp0backend && run.bat"
timeout /t 3 >nul

echo [2/3] 启动前端服务...
start "NOVIX Frontend" cmd /k "cd /d %~dp0frontend && run.bat"

echo.
echo [3/3] 服务启动完成！
echo.
echo ========================================
echo  访问地址:
echo ----------------------------------------
echo  前端界面:   http://localhost:3000
echo  后端 API:   http://localhost:8000
echo  API 文档:   http://localhost:8000/docs
echo ========================================
echo.
echo 提示: 前后端服务已在独立窗口启动
echo       关闭窗口即可停止对应服务
echo.
pause
