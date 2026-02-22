# -*- coding: utf-8 -*-
"""
文枢 WenShape - 深度上下文感知的智能体小说创作系统
WenShape - Deep Context-Aware Agent-Based Novel Writing System

Copyright © 2025-2026 WenShape Team
License: PolyForm Noncommercial License 1.0.0

模块说明 / Module Description:
  配置管理 - 从环境变量和YAML文件加载应用配置
  Configuration Management - Load and manage application configuration from environment and files.

配置源优先级 / Configuration source priority:
  1. Environment variables (.env 文件或系统环境)
  2. YAML config file (config.yaml)
  3. Hard-coded defaults
"""

import os
from pathlib import Path
from typing import Dict, Any
import yaml
from pydantic_settings import BaseSettings, SettingsConfigDict
from dotenv import load_dotenv

# Load environment variables / 加载环境变量
# Supports both frozen (EXE) and dev (source code) modes
import sys
if getattr(sys, 'frozen', False):
    # In frozen mode, load from the directory containing the EXE
    # 冻结模式：从EXE所在目录加载
    env_path = Path(sys.executable).parent / ".env"
    load_dotenv(dotenv_path=env_path)
else:
    # In dev mode, load from project root
    # 开发模式：从项目根目录加载
    load_dotenv()

class Settings(BaseSettings):
    """
    应用设置 / Application settings

    从环境变量和.env文件加载配置。支持两种模式：
    1. 开发模式：从源代码目录加载
    2. 冻结模式（EXE）：从可执行文件旁加载

    Settings loaded from environment variables and .env files.
    Supports both development and frozen (EXE) modes.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Server Configuration / 服务器配置
    host: str = os.getenv("HOST", "0.0.0.0")
    port: int = int(os.getenv("PORT", "8000"))
    debug: bool = os.getenv("DEBUG", "False").lower() == "true"

    # API Keys / API密钥
    # 从环境变量读取，用于认证LLM供应商
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    deepseek_api_key: str = os.getenv("DEEPSEEK_API_KEY", "")
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")

    # Custom LLM Provider / 自定义LLM供应商配置
    # For OpenAI-compatible endpoints
    custom_api_key: str = os.getenv("CUSTOM_API_KEY", "")
    custom_base_url: str = os.getenv("CUSTOM_BASE_URL", "")
    custom_model_name: str = os.getenv("CUSTOM_MODEL_NAME", "")

    # Model Selection per Provider / 各供应商的模型选择
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-4o")
    anthropic_model: str = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")
    deepseek_model: str = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

    # LLM Provider / 大模型供应商选择
    # 可选值：openai, anthropic, deepseek, gemini, mock, custom
    wenshape_llm_provider: str = os.getenv("WENSHAPE_LLM_PROVIDER", "")

    # Per-Agent LLM provider override / 按Agent指定LLM供应商
    # 允许为不同的Agent使用不同的模型以获得最佳效果
    wenshape_agent_archivist_provider: str = os.getenv("WENSHAPE_AGENT_ARCHIVIST_PROVIDER", "")
    wenshape_agent_writer_provider: str = os.getenv("WENSHAPE_AGENT_WRITER_PROVIDER", "")
    wenshape_agent_editor_provider: str = os.getenv("WENSHAPE_AGENT_EDITOR_PROVIDER", "")

    # Storage Configuration / 存储路径配置
    # Default relative path, will be resolved to absolute path
    data_dir: str = "../data"  # Default relative path

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # Dynamic path resolution for data_dir / data_dir 动态路径解析
        import sys
        if getattr(sys, "frozen", False):
            root = Path(sys.executable).parent
            self.data_dir = str(root / "data")
        else:
            project_root = Path(__file__).resolve().parent.parent.parent
            self.data_dir = str((project_root / "data").resolve())


def load_config(config_path: str = "config.yaml") -> Dict[str, Any]:
    """
    从YAML文件加载配置

    Load configuration from YAML file.

    支持环境变量占位符：${VAR_NAME} 格式
    Supports environment variable placeholders: ${VAR_NAME} format

    Args:
        config_path: 配置文件相对路径 / Path to config file relative to project root

    Returns:
        配置字典 / Configuration dictionary

    Raises:
        FileNotFoundError: 如果配置文件不存在 / If config file not found

    Example:
        >>> config = load_config("config.yaml")
        >>> config['llm']['default_provider']
        'deepseek'
    """
    import sys

    # Determine root path: Dev or Frozen (EXE)
    # 确定根路径：开发模式或冻结模式（EXE）
    if getattr(sys, 'frozen', False):
        # Running as PyInstaller Bundle
        # 作为PyInstaller打包的可执行文件运行
        # The config file should be next to the EXE
        root_path = Path(sys.executable).parent
    else:
        # Running as Source Code
        # 作为源代码运行
        root_path = Path(__file__).parent.parent

    config_file = root_path / config_path

    if not config_file.exists():
        raise FileNotFoundError(f"配置文件不存在 / Config file not found: {config_file}")

    with open(config_file, 'r', encoding='utf-8') as f:
        config = yaml.safe_load(f)

    # Replace environment variable placeholders / 替换环境变量占位符
    config = _replace_env_vars(config)

    return config


def _replace_env_vars(obj: Any) -> Any:
    """
    递归替换 ${VAR} 为环境变量值

    Recursively replace ${VAR} with environment variable values.

    Args:
        obj: 任何Python对象（字典、列表、字符串等） / Any Python object

    Returns:
        带环境变量替换的对象 / Object with environment variables replaced

    Example:
        >>> _replace_env_vars({"api_key": "${OPENAI_API_KEY}"})
        {'api_key': 'sk-...'}
    """
    if isinstance(obj, dict):
        return {k: _replace_env_vars(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_replace_env_vars(item) for item in obj]
    elif isinstance(obj, str) and obj.startswith("${") and obj.endswith("}"):
        var_name = obj[2:-1]
        return os.getenv(var_name, "")
    return obj

# Global settings instance / 全局设置实例
settings = Settings()

# Try to load config with fallback / 尝试加载配置，带容错机制
try:
    config = load_config()
except FileNotFoundError as e:
    from app.utils.logger import get_logger
    logger = get_logger(__name__)
    logger.error(f"Failed to load config.yaml: {e}")
    logger.warning("Using minimal configuration fallback, some features may not work correctly")

    # Fallback: minimal config structure
    # 回退：最小化配置结构
    config = {
        "llm": {
            "default_provider": settings.wenshape_llm_provider or "mock",
            "providers": {}
        },
        "session": {
            "max_iterations": 5,
            "timeout_seconds": 600,
        },
        "context_budget": {
            "total_tokens": 128000,
        }
    }


def reload_runtime_config() -> None:
    """
    从更新后的环境变量重载配置

    Reload settings and config from updated environment.

    在运行时更新了环境变量后调用此函数以重新加载配置。
    Call this function after updating environment variables at runtime to reload config.

    Example:
        >>> os.environ['OPENAI_API_KEY'] = 'new-key'
        >>> reload_runtime_config()
        >>> settings.openai_api_key
        'new-key'
    """
    global settings
    global config

    settings = Settings()

    # Try to load config with fallback / 尝试加载配置，带容错机制
    try:
        config = load_config()
    except FileNotFoundError as e:
        from app.utils.logger import get_logger
        logger = get_logger(__name__)
        logger.warning(f"Failed to reload config.yaml: {e}, using fallback")

        # Fallback: minimal config structure
        config = {
            "llm": {
                "default_provider": settings.wenshape_llm_provider or "mock",
                "providers": {}
            },
            "session": {
                "max_iterations": 5,
                "timeout_seconds": 600,
            },
            "context_budget": {
                "total_tokens": 128000,
            }
        }
