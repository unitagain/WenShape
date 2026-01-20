"""
NOVIX Centralized Logging Module
统一日志系统

Usage:
    from app.utils.logger import get_logger
    
    logger = get_logger(__name__)
    logger.info("Application started")
    logger.debug("Debug information")
    logger.error("Error occurred", exc_info=True)
"""

import logging
import sys
from pathlib import Path
from logging.handlers import RotatingFileHandler
from app.config import settings

# Create logs directory if it doesn't exist
if getattr(sys, 'frozen', False):
    # Frozen mode (EXE)
    log_dir = Path(sys.executable).parent / "logs"
else:
    # Dev mode
    log_dir = Path(__file__).parent.parent.parent / "logs"

log_dir.mkdir(exist_ok=True)

# Define log format
LOG_FORMAT = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
DATE_FORMAT = '%Y-%m-%d %H:%M:%S'

def get_logger(name: str) -> logging.Logger:
    """
    Get or create a logger with the specified name
    
    Args:
        name: Logger name (typically __name__)
        
    Returns:
        Configured logger instance
    """
    logger = logging.getLogger(name)
    
    # Avoid adding handlers multiple times
    if logger.handlers:
        return logger
    
    # Set level based on debug mode
    logger.setLevel(logging.DEBUG if settings.debug else logging.INFO)
    
    # Console Handler (always enabled)
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.DEBUG if settings.debug else logging.INFO)
    console_formatter = logging.Formatter(LOG_FORMAT, DATE_FORMAT)
    console_handler.setFormatter(console_formatter)
    logger.addHandler(console_handler)
    
    # File Handler (rotating, max 10MB, keep 5 backups)
    file_handler = RotatingFileHandler(
        log_dir / "novix.log",
        maxBytes=10 * 1024 * 1024,  # 10 MB
        backupCount=5,
        encoding='utf-8'
    )
    file_handler.setLevel(logging.DEBUG)
    file_formatter = logging.Formatter(LOG_FORMAT, DATE_FORMAT)
    file_handler.setFormatter(file_formatter)
    logger.addHandler(file_handler)
    
    return logger


# Module-level initialization
_logger = get_logger(__name__)
_logger.info("Logging system initialized")
