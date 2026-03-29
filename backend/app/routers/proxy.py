"""
Proxy Router
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
    

class TestModelRequest(BaseModel):
    provider: str
    api_key: str
    model: str
    base_url: Optional[str] = None


def _default_base_url_for_provider(provider: str) -> Optional[str]:
    provider = str(provider or "").strip().lower()
    if provider == "openai":
        return "https://api.openai.com/v1"
    if provider == "deepseek":
        return "https://api.deepseek.com/v1"
    if provider == "qwen":
        return "https://dashscope.aliyuncs.com/compatible-mode/v1"
    if provider == "kimi":
        return "https://api.moonshot.cn/v1"
    if provider == "glm":
        return "https://open.bigmodel.cn/api/paas/v4"
    if provider == "gemini":
        return "https://generativelanguage.googleapis.com/v1beta/openai/"
    if provider == "grok":
        return "https://api.x.ai/v1"
    if provider == "wenxin":
        return "https://qianfan.baidubce.com/v2"
    if provider == "aistudio":
        return "https://aistudio.baidu.com/llm/lmapi/v3"
    if provider == "anthropic":
        return "https://api.anthropic.com"
    return None


ANTHROPIC_FALLBACK_MODELS: List[str] = [
    # Fallback when model list fetch fails; keep small and stable.
    "claude-opus-4-6",
    "claude-sonnet-4-6",
    "claude-sonnet-4-5",
    "claude-haiku-4-5",
]

@router.post("/fetch-models")
async def fetch_models(request: FetchModelsRequest):
    """
    Fetch available models from the provider
    """
    try:
        provider = str(request.provider or "").strip().lower()
        base_url = (request.base_url or "").strip() or None

        # Anthropic: use official SDK Models API (not OpenAI-compatible /v1/models).
        # Always return from this branch to avoid fallthrough to OpenAI client.
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
                    "warning": "Anthropic model list empty, returning built-in fallback list.",
                }
            except Exception as e:
                logger.warning("Fetch Models Error (anthropic): %s", str(e))
                return {
                    "models": ANTHROPIC_FALLBACK_MODELS,
                    "warning": f"Anthropic model list fetch failed, returning built-in fallback. Reason: {str(e)}",
                }

        # Determine base URL based on provider if not provided
        if not base_url:
            base_url = _default_base_url_for_provider(provider)

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
        detail = str(e)
        # Extract status code from provider SDK exceptions when available
        status_code = getattr(e, 'status_code', None) or 400
        raise HTTPException(status_code=status_code, detail=detail)


@router.post("/test-model")
async def test_model(request: TestModelRequest):
    """
    Test whether provider config and selected model are usable.
    """
    try:
        provider = str(request.provider or "").strip().lower()
        model = str(request.model or "").strip()
        if not model:
            raise HTTPException(status_code=400, detail="Model is required.")

        base_url = (request.base_url or "").strip() or _default_base_url_for_provider(provider)

        if provider == "anthropic":
            if base_url:
                client = AsyncAnthropic(api_key=request.api_key, base_url=base_url)
            else:
                client = AsyncAnthropic(api_key=request.api_key)
            response = await client.messages.create(
                model=model,
                max_tokens=16,
                temperature=0.0,
                messages=[{"role": "user", "content": "Reply with OK only."}],
            )
            content = ""
            if hasattr(response, "content") and response.content:
                first = response.content[0]
                content = getattr(first, "text", "") or ""
            return {"success": True, "provider": provider, "model": model, "message": content or "OK"}

        client = AsyncOpenAI(api_key=request.api_key, base_url=base_url)
        try:
            response = await client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": "Reply with OK only."}],
                temperature=0.0,
                max_tokens=16,
            )
        except Exception as first_error:
            # Some OpenAI-compatible providers may require max_completion_tokens.
            err = str(first_error).lower()
            if "max_tokens" in err:
                response = await client.chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": "Reply with OK only."}],
                    temperature=0.0,
                    max_completion_tokens=16,
                )
            else:
                raise

        content = ""
        if hasattr(response, "choices") and response.choices:
            content = response.choices[0].message.content or ""
        return {"success": True, "provider": provider, "model": model, "message": content or "OK"}
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("Test Model Error: %s", str(e))
        status_code = getattr(e, "status_code", None) or 400
        raise HTTPException(status_code=status_code, detail=str(e))
