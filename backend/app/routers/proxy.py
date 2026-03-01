"""
Proxy Router / 代理路由
Handles direct requests to LLM providers for configuration purposes (e.g., fetching models)
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from openai import AsyncOpenAI
from anthropic import AsyncAnthropic
from app.utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/proxy", tags=["proxy"])

class FetchModelsRequest(BaseModel):
    provider: str
    api_key: str
    base_url: Optional[str] = None


ANTHROPIC_FALLBACK_MODELS: List[str] = [
    # 用于"拉取模型列表"失败时的兜底；保持小而稳定，避免 UI 无法继续配置。
    "claude-opus-4-6",
    "claude-sonnet-4-6",
]

@router.post("/fetch-models")
async def fetch_models(request: FetchModelsRequest):
    """
    Fetch available models from the provider
    """
    try:
        provider = str(request.provider or "").strip().lower()
        base_url = (request.base_url or "").strip() or None

        # Anthropic: 使用官方 SDK 的 Models API（而不是 OpenAI 兼容的 /v1/models）。
        # 注意：无论成功/失败都要 return，避免 fallthrough 到 OpenAI 客户端导致 400（前端误以为"拉取失败"）。
        if provider == "anthropic":
            try:
                logger.debug("Fetch Models Debug: Provider=anthropic, BaseURL=%s", base_url or "(default)")
                if base_url:
                    client = AsyncAnthropic(api_key=request.api_key, base_url=base_url)
                else:
                    client = AsyncAnthropic(api_key=request.api_key)

                paginator = client.models.list(limit=200)
                model_ids: List[str] = []
                async for model in paginator:
                    model_id = getattr(model, "id", None)
                    if model_id:
                        model_ids.append(str(model_id))
                    if len(model_ids) >= 200:
                        break

                if model_ids:
                    logger.info("Fetch Models Success: Found %s models (anthropic)", len(model_ids))
                    return {"models": sorted(set(model_ids))}

                logger.warning("Fetch Models Warning (anthropic): empty models list")
                return {
                    "models": ANTHROPIC_FALLBACK_MODELS,
                    "warning": "Anthropic 模型列表为空，已返回内置候选列表（实际可用性以真实调用为准）。",
                }
            except Exception as e:
                logger.warning("Fetch Models Error (anthropic): %s", str(e))
                return {
                    "models": ANTHROPIC_FALLBACK_MODELS,
                    "warning": f"Anthropic 模型列表拉取失败，已返回内置候选列表。原因：{str(e)}",
                }

        # Determine base URL based on provider if not provided
        if not base_url:
            if provider == "openai":
                base_url = None  # Default
            elif provider == "deepseek":
                base_url = "https://api.deepseek.com/v1"
            elif provider == "qwen":
                base_url = "https://dashscope.aliyuncs.com/compatible-mode/v1"
            elif provider == "kimi":
                base_url = "https://api.moonshot.cn/v1"
            elif provider == "glm":
                base_url = "https://open.bigmodel.cn/api/paas/v4"
            elif provider == "gemini":
                base_url = "https://generativelanguage.googleapis.com/v1beta/openai/"
            elif provider == "grok":
                base_url = "https://api.x.ai/v1"
        
        # Initialize temp client
        # Note: Some providers might not implement /v1/models correctly.
        logger.debug("Fetch Models Debug: Provider=%s, BaseURL=%s", provider, base_url)
        
        client = AsyncOpenAI(
            api_key=request.api_key,
            base_url=base_url
        )
        
        models_response = await client.models.list()
        
        # Extract model IDs
        model_ids = [m.id for m in models_response.data]
        logger.info("Fetch Models Success: Found %s models", len(model_ids))
        return {"models": sorted(model_ids)}
        
    except Exception as e:
        logger.warning("Fetch Models Error: %s", str(e))
        raise HTTPException(status_code=400, detail=str(e))
