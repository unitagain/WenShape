"""
Proxy Router / 代理路由
Handles direct requests to LLM providers for configuration purposes (e.g., fetching models)
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from openai import AsyncOpenAI

router = APIRouter(prefix="/proxy", tags=["proxy"])

class FetchModelsRequest(BaseModel):
    provider: str
    api_key: str
    base_url: Optional[str] = None

@router.post("/fetch-models")
async def fetch_models(request: FetchModelsRequest):
    """
    Fetch available models from the provider
    """
    try:
        # Determine base URL based on provider if not provided
        base_url = request.base_url
        if not base_url:
            if request.provider == "openai":
                base_url = None # Default
            elif request.provider == "anthropic":
                # Anthropic direct fetch might differ, but if using openai-compatible adapter:
                # Actually, our AnthropicProvider uses special adapter? 
                # For fetching models via OpenAI SDK, provider must support OpenAI API
                # Most custom providers do. Official Anthropic API is different.
                # If provider is anthropic, we might fail if trying to use OpenAI SDK unless we use a bridge.
                # For now, let's assume OpenAI-compatible providers or custom base_url.
                pass
            elif request.provider == "deepseek":
                base_url = "https://api.deepseek.com/v1"
            elif request.provider == "qwen":
                base_url = "https://dashscope.aliyuncs.com/compatible-mode/v1"
            elif request.provider == "kimi":
                base_url = "https://api.moonshot.cn/v1"
            elif request.provider == "glm":
                base_url = "https://open.bigmodel.cn/api/paas/v4"
            elif request.provider == "gemini":
                base_url = "https://generativelanguage.googleapis.com/v1beta/openai/"
            elif request.provider == "grok":
                base_url = "https://api.x.ai/v1"
        
        # Initialize temp client
        # Note: Some providers might not implement /v1/models correctly.
        print(f"Fetch Models Debug: Provider={request.provider}, BaseURL={base_url}, Key={request.api_key[:8]}***")
        
        client = AsyncOpenAI(
            api_key=request.api_key,
            base_url=base_url
        )
        
        models_response = await client.models.list()
        
        # Extract model IDs
        model_ids = [m.id for m in models_response.data]
        print(f"Fetch Models Success: Found {len(model_ids)} models")
        return {"models": sorted(model_ids)}
        
    except Exception as e:
        print(f"Fetch Models Error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
