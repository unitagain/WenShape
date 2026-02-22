from pathlib import Path
from typing import Dict, Any, Optional, List

from fastapi import APIRouter, HTTPException, Body
from pydantic import BaseModel
import app.config as app_config
from app.services.llm_config_service import llm_config_service
from app.llm_gateway import reset_gateway

router = APIRouter(prefix="/config", tags=["config"])

# --- Schemas ---

class LLMProfile(BaseModel):
    id: Optional[str] = None
    name: str = "New Profile"
    provider: str  # openai, anthropic, deepseek, gemini, custom
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model: Optional[str] = None
    temperature: float = 0.7
    max_tokens: int = 8000
    
class AgentAssignments(BaseModel):
    archivist: Optional[str] = None
    writer: Optional[str] = None
    editor: Optional[str] = None

# --- Endpoints ---

@router.get("/llm/profiles")
async def get_profiles():
    """Get all LLM profiles"""
    return llm_config_service.get_profiles()

@router.post("/llm/profiles")
async def save_profile(profile: LLMProfile):
    """Create or update a profile"""
    saved = llm_config_service.save_profile(profile.dict())
    reset_gateway() # Reset gateway to pick up changes if assignment uses this profile
    return saved

@router.delete("/llm/profiles/{profile_id}")
async def delete_profile(profile_id: str):
    """Delete a profile"""
    llm_config_service.delete_profile(profile_id)
    reset_gateway()
    return {"success": True}

@router.get("/llm/assignments")
async def get_assignments():
    """Get current agent assignments (profile IDs)"""
    return llm_config_service.get_assignments()

@router.post("/llm/assignments")
async def update_assignments(assignments: AgentAssignments):
    """Update agent assignments"""
    # Filter out None values
    clean = {k: v for k, v in assignments.dict().items() if v is not None}
    llm_config_service.save_assignments(clean)
    reset_gateway()
    return {"success": True}

@router.get("/llm/providers_meta")
async def get_providers_meta():
    """Get metadata about available providers (for UI dropdowns)"""
    return [
        {"id": "openai", "label": "OpenAI", "fields": ["api_key", "model"]},
        {"id": "anthropic", "label": "Anthropic (Claude)", "fields": ["api_key", "model"]},
        {"id": "deepseek", "label": "DeepSeek", "fields": ["api_key", "model"]},
        {"id": "gemini", "label": "Gemini (Google)", "fields": ["api_key", "model"]},
        {"id": "custom", "label": "Custom / OpenAI Compatible", "fields": ["base_url", "api_key", "model"]},
    ]

# --- Legacy Endpoint Support (Optional, keep if frontend needs partial compatibility during transition) ---
# For now we assume we are fully refactoring frontend too.
