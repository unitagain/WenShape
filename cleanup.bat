@echo off
REM NOVIX Project Cleanup Script
REM 清理项目冗余文件

echo ========================================
echo   NOVIX 项目清理工具
echo ========================================
echo.

echo [1/5] 清理 Python 缓存文件...
FOR /d /r . %%d IN (__pycache__) DO @IF EXIST "%%d" rd /s /q "%%d"
del /s /q *.pyc *.pyo 2>nul

echo [2/5] 清理构建产物...
IF EXIST build rd /s /q build
IF EXIST dist rd /s /q dist
IF EXIST frontend\dist rd /s /q frontend\dist
IF EXIST backend\static rd /s /q backend\static

echo [3/5] 清理日志文件...
del /s /q *.log 2>nul
IF EXIST traces rd /s /q traces

echo [4/5] 清理临时文件...
del /s /q test_*.py debug_*.py verify_api_config.py 2>nul

echo [5/5] 清理完成！
echo.
echo ========================================
echo  清理总结:
echo ----------------------------------------
echo  - Python 缓存文件 (.pyc, __pycache__)
echo  - 构建产物 (build, dist)
echo  - 日志文件 (*.log, traces)
echo  - 调试脚本 (test_*.py, debug_*.py)
echo ========================================
echo.
echo 注意: 依赖目录未删除 (venv, node_modules)
echo 如需清理依赖，请手动删除后重新安装：
echo   - 后端: pip install -r backend\requirements.txt
echo   - 前端: npm install
echo.
pause
