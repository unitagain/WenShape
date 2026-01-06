
import os
import shutil
import subprocess
import sys
from pathlib import Path

def run_command(cmd, cwd=None):
    print(f"Running: {cmd}")
    subprocess.check_call(cmd, shell=True, cwd=cwd)

def build_frontend():
    print("--- Building Frontend ---")
    frontend_dir = Path("frontend")
    if not frontend_dir.exists():
        print("Frontend directory not found!")
        sys.exit(1)
    
    # Install dependencies
    run_command("npm install", cwd=frontend_dir)
    # Build
    run_command("npm run build", cwd=frontend_dir)

def prepare_backend_assets():
    print("--- Preparing Backend Assets ---")
    # Clean previous build
    backend_static = Path("backend/static")
    if backend_static.exists():
        shutil.rmtree(backend_static)
        
    # Copy dist to backend/static
    frontend_dist = Path("frontend/dist")
    if not frontend_dist.exists():
        print("Frontend build failed: dist not found")
        sys.exit(1)
        
    shutil.copytree(frontend_dist, backend_static)
    print(f"Copied frontend assets to {backend_static}")

def run_pyinstaller():
    print("--- Packaging with PyInstaller ---")
    
    # Ensure pyinstaller is installed
    subprocess.check_call([sys.executable, "-m", "pip", "install", "pyinstaller", "aiofiles", "uvicorn", "fastapi", "python-multipart"])
    
    # Command arguments
    args = [
        "pyinstaller",
        "--name", "NOVIX",
        "--clean",
        "--noconfirm",
        # Add backend/static directory to the bundle
        "--add-data", f"backend/static{os.pathsep}static",
        # Add config templates if needed, but we expect external config.yaml
        # However, let's include a default config.yaml for first run?
        # Maybe copy env.example or config.yaml to dist folder later
        
        # Hidden imports often missed by PyInstaller
        "--hidden-import", "uvicorn.logging",
        "--hidden-import", "uvicorn.loops",
        "--hidden-import", "uvicorn.loops.auto",
        "--hidden-import", "uvicorn.protocols",
        "--hidden-import", "uvicorn.protocols.http",
        "--hidden-import", "uvicorn.protocols.http.auto",
        "--hidden-import", "uvicorn.lifespan",
        "--hidden-import", "uvicorn.lifespan.on",
        "--hidden-import", "engineio.async_drivers.aiohttp",
        # Dependencies for search and agents
        "--hidden-import", "duckduckgo_search",
        "--hidden-import", "curl_cffi",
        "--collect-all", "curl_cffi", 
        "--collect-all", "duckduckgo_search",
        
        # Entry point
        "backend/app/main.py"
    ]
    
    run_command(" ".join(args), cwd=".")
    
def finalize_package():
    print("--- Finalizing Package ---")
    dist_dir = Path("dist/NOVIX")
    
    # 1. Copy config example or config.yaml
    config_src = Path("backend/config.yaml")
    if config_src.exists():
        shutil.copy(config_src, dist_dir / "config.yaml")
        print("Copied config.yaml")
        
    # 2. Copy .env.example for safe configuration
    env_example = Path(".env.example")
    if env_example.exists():
        shutil.copy(env_example, dist_dir / ".env.example")
        print("Copied .env.example")
    
    # Do NOT copy .env automatically to prevent secret leakage
    # env_src = Path("backend/.env")
    # if env_src.exists():
    #     shutil.copy(env_src, dist_dir / ".env")
    #     print("Copied .env")

    # 3. Create run.bat for convenience (optional, exe is enough)
    
    # 4. Create data folder
    (dist_dir / "data").mkdir(exist_ok=True)
    
    print(f"\nBuild Complete! Output in: {dist_dir.absolute()}")

if __name__ == "__main__":
    # Check current directory
    if not Path("backend").exists() or not Path("frontend").exists():
        print("Error: Please run this script from the project root (where backend/ and frontend/ folders are).")
        sys.exit(1)

    build_frontend()
    prepare_backend_assets()
    run_pyinstaller()
    finalize_package()
