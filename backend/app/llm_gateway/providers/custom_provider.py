"""
Custom LLM Provider / 自定义模型适配器 (OpenAI 兼容)
"""

from typing import List, Dict, Any, Optional
from openai import AsyncOpenAI
from app.llm_gateway.providers.base import BaseLLMProvider


class CustomProvider(BaseLLMProvider):
    """Custom OpenAI-compatible API provider / 自定义 OpenAI 兼容 API 提供商"""
    
    def __init__(
        self,
        api_key: str,
        base_url: str,
        model: str,
        max_tokens: int = 8000,
        temperature: float = 0.7
    ):
        super().__init__(api_key, model, max_tokens, temperature)
        # Ensure base_url is valid, if empty default to None (which defaults to standard OpenAI)
        # But for 'custom', user likely provides a specific URL.
        # If user leaves it blank but uses 'custom', it behaves like standard OpenAI? 
        # Better to pass it explicitely.
        self.client = AsyncOpenAI(api_key=api_key, base_url=base_url if base_url else None)
    
    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Send chat request to Custom Provider
        发送聊天请求到自定义提供商
        """
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=temperature or self.temperature,
            max_tokens=max_tokens or self.max_tokens
        )
        
        return {
            "content": response.choices[0].message.content,
            "usage": {
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens,
                "total_tokens": response.usage.total_tokens
            },
            "model": response.model,
            "finish_reason": response.choices[0].finish_reason
        }
    
    def get_provider_name(self) -> str:
        """Get provider name / 获取提供商名称"""
        return "custom"
