#!/bin/bash

echo "========================================"
echo "   NOVIX 一键启动"
echo "========================================"
echo ""

# 检查 Python
if ! command -v python3 &> /dev/null; then
    echo "[错误] 未检测到 Python，请先安装 Python 3.10+"
    echo "下载地址: https://www.python.org/downloads/"
    echo ""
    exit 1
fi

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "[错误] 未检测到 Node.js，请先安装 Node.js 18+"
    echo "下载地址: https://nodejs.org/"
    echo ""
    exit 1
fi

# 获取脚本所在目录
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "[1/3] 启动后端服务..."
osascript -e "tell app \"Terminal\" to do script \"cd '$SCRIPT_DIR/backend' && ./run.sh\"" 2>/dev/null || \
gnome-terminal -- bash -c "cd '$SCRIPT_DIR/backend' && ./run.sh; exec bash" 2>/dev/null || \
xterm -e "cd '$SCRIPT_DIR/backend' && ./run.sh" 2>/dev/null &

sleep 3

echo "[2/3] 启动前端服务..."
osascript -e "tell app \"Terminal\" to do script \"cd '$SCRIPT_DIR/frontend' && ./run.sh\"" 2>/dev/null || \
gnome-terminal -- bash -c "cd '$SCRIPT_DIR/frontend' && ./run.sh; exec bash" 2>/dev/null || \
xterm -e "cd '$SCRIPT_DIR/frontend' && ./run.sh" 2>/dev/null &

echo ""
echo "[3/3] 服务启动完成！"
echo ""
echo "========================================"
echo " 访问地址:"
echo "----------------------------------------"
echo " 前端界面:   http://localhost:3000"
echo " 后端 API:   http://localhost:8000"
echo " API 文档:   http://localhost:8000/docs"
echo "========================================"
echo ""
echo "提示: 前后端服务已在独立终端启动"
echo "      关闭对应终端即可停止服务"
echo ""
