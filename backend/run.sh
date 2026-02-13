#!/bin/bash
# NOVIX Backend Startup Script for Linux/Mac
# Linux/Mac 启动脚本

echo "Starting NOVIX Backend Server..."
echo "正在启动 NOVIX 后端服务器..."

# Optional mode flag: test / --test
TEST_MODE=0
for arg in "$@"; do
    if [ "$arg" = "test" ] || [ "$arg" = "--test" ]; then
        TEST_MODE=1
        echo "Test mode enabled: passing 'test' arg to app.main"
    fi
done

# Detect python3 or python, set PYTHON variable
if command -v python3 &> /dev/null; then
    PYTHON=python3
elif command -v python &> /dev/null; then
    PYTHON=python
else
    echo "[错误] 未检测到 Python，请先安装 Python 3.10+"
    exit 1
fi
echo "Using Python interpreter: $($PYTHON --version 2>&1)"

# Check if virtual environment exists / 检查虚拟环境是否存在
if [ ! -d "venv" ]; then
    echo "Virtual environment not found. Creating..."
    echo "虚拟环境不存在，正在创建..."
    $PYTHON -m venv venv
fi

source venv/bin/activate

echo "Installing dependencies..."
echo "正在安装依赖..."
$PYTHON -m pip install -r requirements.txt

# Check if .env exists / 检查 .env 是否存在
if [ ! -f ".env" ]; then
    echo "Warning: .env file not found. Copying from .env.example..."
    echo "警告：.env 文件不存在，正在从 .env.example 复制..."
    cp .env.example .env
    echo "Please edit .env file and add your API keys!"
    echo "请编辑 .env 文件并添加你的 API 密钥！"
    echo "Press Enter to continue..."
    read
fi

# Start server / 启动服务器
echo ""
echo "Starting server at http://localhost:8000"
echo "服务器启动于 http://localhost:8000"
echo "API Docs: http://localhost:8000/docs"
echo ""

$PYTHON -m app.main "$@"
