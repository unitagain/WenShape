"""
Configuration Management / 配置管理
Load and manage application configuration / 加载和管理应用配置
"""

import os
from pathlib import Path
from typing import Dict, Any
import yaml
from pydantic_settings import BaseSettings, SettingsConfigDict
from dotenv import load_dotenv

# Load environment variables / 加载环境变量
import sys
if getattr(sys, 'frozen', False):
    # In frozen mode, load from the directory containing the EXE
    env_path = Path(sys.executable).parent / ".env"
    load_dotenv(dotenv_path=env_path)
else:
    load_dotenv()

class Settings(BaseSettings):
    """Application settings / 应用设置"""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    
    # Server Configuration / 服务器配置
    host: str = os.getenv("HOST", "0.0.0.0")
    port: int = int(os.getenv("PORT", "8000"))
    debug: bool = os.getenv("DEBUG", "False").lower() == "true"
    
    # API Keys / API 密钥
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    deepseek_api_key: str = os.getenv("DEEPSEEK_API_KEY", "")
    
    # Custom LLM Provider / 自定义模型配置
    custom_api_key: str = os.getenv("CUSTOM_API_KEY", "")
    custom_base_url: str = os.getenv("CUSTOM_BASE_URL", "")
    custom_model_name: str = os.getenv("CUSTOM_MODEL_NAME", "")

    # Model Selection per Provider / 各提供商的模型选择
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-4o")
    anthropic_model: str = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")
    deepseek_model: str = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")

    # LLM Provider / 大模型供应商
    novix_llm_provider: str = os.getenv("NOVIX_LLM_PROVIDER", "")

    novix_agent_archivist_provider: str = os.getenv("NOVIX_AGENT_ARCHIVIST_PROVIDER", "")
    novix_agent_writer_provider: str = os.getenv("NOVIX_AGENT_WRITER_PROVIDER", "")
    novix_agent_reviewer_provider: str = os.getenv("NOVIX_AGENT_REVIEWER_PROVIDER", "")
    novix_agent_editor_provider: str = os.getenv("NOVIX_AGENT_EDITOR_PROVIDER", "")
    
    # Storage Configuration / 存储路径配置
    # Note: Will be calculated in load_config logic if needed, but here we set default
    # If using absolute path in .env, use it. Otherwise relative.
    # We need a dynamic property for this in usage.
    data_dir: str = "../data"  # Default relative path


def load_config(config_path: str = "config.yaml") -> Dict[str, Any]:
    """
    Load configuration from YAML file / 从 YAML 文件加载配置
    
    Args:
        config_path: Path to config file / 配置文件路径
        
    Returns:
        Configuration dictionary / 配置字典
    """
    import sys
    
    # Determine root path: Dev or Frozen (EXE)
    if getattr(sys, 'frozen', False):
        # Running as PyInstaller Bundle
        # The config file should be next to the EXE
        root_path = Path(sys.executable).parent
    else:
        # Running as Source Code
        root_path = Path(__file__).parent.parent

    config_file = root_path / config_path
    
    if not config_file.exists():
        raise FileNotFoundError(f"Config file not found: {config_file}")
    
    with open(config_file, 'r', encoding='utf-8') as f:
        config = yaml.safe_load(f)
    
    # Replace environment variable placeholders / 替换环境变量占位符
    config = _replace_env_vars(config)
    
    return config


def _replace_env_vars(obj: Any) -> Any:
    """
    Recursively replace ${VAR} with environment variable values
    递归替换 ${VAR} 为环境变量值
    """
    if isinstance(obj, dict):
        return {k: _replace_env_vars(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_replace_env_vars(item) for item in obj]
    elif isinstance(obj, str) and obj.startswith("${") and obj.endswith("}"):
        var_name = obj[2:-1]
        return os.getenv(var_name, "")
    return obj


    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # Dynamic path resolution for data_dir
        import sys
        if getattr(sys, 'frozen', False):
             # Frozen: data dir is next to EXE
             root = Path(sys.executable).parent
             self.data_dir = str(root / "data")
        else:
             # Dev: data dir is relative to source
             # Although default is "../data", we can make it absolute for clarity
             pass

# Global settings instance / 全局设置实例
settings = Settings()
config = load_config()


def reload_runtime_config() -> None:
    """Reload settings and config from updated environment / 从更新后的环境变量重载配置"""
    global settings
    global config

    settings = Settings()
    config = load_config()
