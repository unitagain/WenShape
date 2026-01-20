
import json
import uuid
import os
import sys
from pathlib import Path
from typing import List, Dict, Any, Optional
from datetime import datetime
import app.config as app_config
from app.utils.logger import get_logger

logger = get_logger(__name__)

class LLMConfigService:
    def __init__(self):
        self.data_dir = self._get_data_dir()
        self.profiles_path = self.data_dir / "llm_profiles.json"
        self.assignments_path = self.data_dir / "agent_assignments.json"
        self._ensure_data_dir()
        self._migrate_legacy_config()

    def _get_data_dir(self) -> Path:
        """Get the persistent data directory."""
        if getattr(sys, 'frozen', False):
             # Frozen: data dir is next to EXE/data
             return Path(sys.executable).parent / "data"
        else:
             # Dev: backend/data (or ../data relative to this file?)
             # Assuming standard structure: backend/app/services/ -> backend/data
             return Path(__file__).resolve().parents[2] / "data"

    def _ensure_data_dir(self):
        self.data_dir.mkdir(parents=True, exist_ok=True)

    def _load_json(self, path: Path, default: Any) -> Any:
        if not path.exists():
            return default
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error loading {path}: {e}")
            return default

    def _save_json(self, path: Path, data: Any):
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def get_profiles(self) -> List[Dict[str, Any]]:
        return self._load_json(self.profiles_path, [])

    def get_assignments(self) -> Dict[str, str]:
        return self._load_json(self.assignments_path, {
            "archivist": "", "writer": "", "reviewer": "", "editor": ""
        })

    def save_profile(self, profile: Dict[str, Any]) -> Dict[str, Any]:
        profiles = self.get_profiles()
        
        # If new profile
        if "id" not in profile or not profile["id"]:
            profile["id"] = str(uuid.uuid4())
            profile["created_at"] = int(datetime.now().timestamp())
            profiles.append(profile)
        else:
            # Update existing
            for i, p in enumerate(profiles):
                if p["id"] == profile["id"]:
                    profiles[i] = {**p, **profile} # Merge updates
                    break
        
        self._save_json(self.profiles_path, profiles)
        return profile

    def delete_profile(self, profile_id: str):
        profiles = self.get_profiles()
        profiles = [p for p in profiles if p["id"] != profile_id]
        self._save_json(self.profiles_path, profiles)
        
        # Also clean up assignments
        assignments = self.get_assignments()
        changed = False
        for agent, pid in assignments.items():
            if pid == profile_id:
                assignments[agent] = ""
                changed = True
        if changed:
            self.save_assignments(assignments)

    def save_assignments(self, assignments: Dict[str, str]):
        current = self.get_assignments()
        current.update(assignments)
        self._save_json(self.assignments_path, current)

    def get_profile_by_id(self, profile_id: str) -> Optional[Dict[str, Any]]:
        profiles = self.get_profiles()
        for p in profiles:
            if p["id"] == profile_id:
                return p
        return None

    def _migrate_legacy_config(self):
        """Migrate .env settings to profiles if profiles.json is empty."""
        profiles = self.get_profiles()
        if profiles:
            return  # Already has profiles, skip migration

        logger.info("Migrating legacy configuration...")
        new_profiles = []
        
        # Helper to check if a key is real
        def is_real_key(val):
            return val and not str(val).startswith("sk-your") and not str(val).startswith("your-")

        # OpenAI
        openai_key = app_config.settings.openai_api_key
        if is_real_key(openai_key):
            new_profiles.append({
                "id": str(uuid.uuid4()),
                "name": "Legacy OpenAI",
                "provider": "openai",
                "api_key": openai_key,
                "model": app_config.settings.openai_model or "gpt-4o",
                "temperature": 0.7
            })

        # Anthropic
        ant_key = app_config.settings.anthropic_api_key
        if is_real_key(ant_key):
            new_profiles.append({
                "id": str(uuid.uuid4()),
                "name": "Legacy Anthropic",
                "provider": "anthropic",
                "api_key": ant_key,
                "model": app_config.settings.anthropic_model or "claude-3-5-sonnet-20241022",
                "temperature": 0.7
            })

        # Custom
        custom_url = app_config.settings.custom_base_url
        if custom_url:
            new_profiles.append({
                "id": str(uuid.uuid4()),
                "name": "Legacy Custom/SiliconFlow",
                "provider": "custom",
                "api_key": app_config.settings.custom_api_key,
                "base_url": custom_url,
                "model": app_config.settings.custom_model_name or "default-model",
                "temperature": 0.7
            })

        # DeepSeek
        deepseek_key = app_config.settings.deepseek_api_key
        if is_real_key(deepseek_key):
             new_profiles.append({
                "id": str(uuid.uuid4()),
                "name": "Legacy DeepSeek",
                "provider": "deepseek",
                "api_key": deepseek_key,
                "model": app_config.settings.deepseek_model or "deepseek-chat",
                "temperature": 0.7
            })

        if new_profiles:
            self._save_json(self.profiles_path, new_profiles)
            
            # Setup default assignments
            # Assume the first valid profile is the default
            default_id = new_profiles[0]["id"]
            assignments = {
                "archivist": default_id,
                "writer": default_id,
                "reviewer": default_id,
                "editor": default_id
            }
            self._save_json(self.assignments_path, assignments)
            logger.info(f"Migrated {len(new_profiles)} profiles")

# Global instance
llm_config_service = LLMConfigService()
