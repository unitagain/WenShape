"""
NOVIX FastAPI Application Entry Point
FastAPI 应用入口
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.routers import (
    projects_router,
    cards_router,
    canon_router,
    drafts_router,
    session_router,
    config_router
)
from app.routers.fanfiction import router as fanfiction_router
from app.routers.websocket import router as websocket_router

# Create FastAPI application / 创建 FastAPI 应用
app = FastAPI(
    title="NOVIX API",
    description="Multi-Agent Novel Writing System / 多智能体小说写作系统",
    version="0.1.0",
    debug=settings.debug
)

# Configure CORS / 配置跨域
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # TODO: Configure properly for production / 生产环境需要配置具体域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers / 注册路由
# Register routers / 注册路由
# Strategy: Dual Mount
# Mount at root "/" for Dev mode (where Vite proxy strips /api)
# Mount at "/api" for Prod/EXE mode (where frontend calls /api directly)
routers = [
    projects_router,
    cards_router,
    canon_router,
    drafts_router,
    session_router,
    config_router,
    websocket_router,
    fanfiction_router
]

for router in routers:
    app.include_router(router)              # Dev: http://localhost:8000/projects
    app.include_router(router, prefix="/api") # Prod: http://localhost:8000/api/projects





@app.get("/health")
async def health_check():
    """Health check endpoint / 健康检查"""
    return {"status": "ok"}

@app.on_event("startup")
async def on_startup():
    """Startup event handler / 启动事件处理"""
    import sys
    import webbrowser
    import asyncio
    
    # Auto-open browser in a separate thread to not block startup
    # But webbrowser.open is usually fire-and-forget
    if getattr(sys, 'frozen', False):
        url = f"http://localhost:{settings.port}"
        print(f"[Main] Auto-opening browser at {url} ...")
        # Small delay to ensure server is ready
        async def open_browser():
            await asyncio.sleep(1.5)
            webbrowser.open(url)
        asyncio.create_task(open_browser())

# --- Static Files / SPA Support (Added for Packaging) ---
import sys
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path

# Check where static files are located
if getattr(sys, 'frozen', False):
    # Running as PyInstaller Bundle
    base_path = getattr(sys, '_MEIPASS', Path(sys.executable).parent)
    static_dir = Path(base_path) / "static"
else:
    # Dev: Look for backend/static if it exists (for testing build script without freezing)
    static_dir = Path(__file__).parent.parent / "static"

if static_dir.exists():
    print(f"[Main] Serving static files from: {static_dir}")
    
    # 1. Mount assets (css, js, images)
    app.mount("/assets", StaticFiles(directory=str(static_dir / "assets")), name="assets")
    
    # 2. Serve Index at Root
    @app.get("/")
    async def serve_root():
        return FileResponse(static_dir / "index.html")

    # 3. Catch-all for SPA routes (Serve index.html)
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # Safety: If request asks for /api/..., and we reached here, it's a 404.
        # Don't return HTML, otherwise frontend crashes (SyntaxError).
        if full_path.startswith("api/") or full_path.startswith("api"):
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="API Endpoint Not Found")

        # Check if file exists in static (e.g. favicon.ico)
        file_path = static_dir / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
            
        # Otherwise serve index.html for SPA routing
        return FileResponse(static_dir / "index.html")
else:
    print("[Main] Static directory not found. Running in API-only mode (Dev).")


if __name__ == "__main__":
    import uvicorn
    import multiprocessing
    
    # Critical for Windows EXE to prevent infinite spawn loop
    multiprocessing.freeze_support()
    
    # Determine execution mode
    is_frozen = getattr(sys, 'frozen', False)
    
    if is_frozen:
        # Prod/EXE: Run directly with app instance, NO RELOAD
        # Reloading in frozen mode causes infinite subprocess spawning
        print("[Main] Running in Frozen (EXE) Mode")
        uvicorn.run(
            app,  # Pass app instance directly, not string
            host=settings.host, 
            port=settings.port, 
            reload=False,
            log_level="info"
        )
    else:
        # Dev: Run with reload
        print("[Main] Running in Dev Mode")
        uvicorn.run(
            "app.main:app",
            host=settings.host,
            port=settings.port,
            reload=settings.debug
        )
