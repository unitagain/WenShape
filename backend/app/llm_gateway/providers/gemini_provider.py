"""
Google Gemini Provider / 谷歌 Gemini 适配器
Compatible with OpenAI API / 兼容 OpenAI API
"""

from typing import List, Dict, Any, Optional, AsyncGenerator
from openai import AsyncOpenAI
from app.llm_gateway.providers.base import BaseLLMProvider


class GeminiProvider(BaseLLMProvider):
    """Google Gemini provider (OpenAI-compatible endpoint)."""

    DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"

    def __init__(
        self,
        api_key: str,
        model: str = "gemini-2.5-flash",
        max_tokens: int = 8000,
        temperature: float = 0.7
    ):
        super().__init__(api_key, model, max_tokens, temperature)
        self.client = AsyncOpenAI(api_key=api_key, base_url=self.DEFAULT_BASE_URL)

    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Send chat request to Gemini.
        发送聊天请求到 Gemini

        Args:
            messages: List of messages / 消息列表
            temperature: Override temperature / 覆盖温度
            max_tokens: Override max tokens / 覆盖最大token数
        
        Returns:
            Response dict / 响应字典
        """
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=temperature or self.temperature,
            max_tokens=max_tokens or self.max_tokens,
        )

        usage = response.usage
        return {
            "content": response.choices[0].message.content,
            "usage": {
                "prompt_tokens": usage.prompt_tokens,
                "completion_tokens": usage.completion_tokens,
                "total_tokens": usage.total_tokens,
            },
            "model": response.model,
            "finish_reason": response.choices[0].finish_reason,
        }

    def get_provider_name(self) -> str:
        return "gemini"
