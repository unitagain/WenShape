"""
Google Gemini Provider / 谷歌 Gemini 适配器
Compatible with OpenAI API / 兼容 OpenAI API
"""

from app.llm_gateway.providers.custom_provider import CustomProvider

class GeminiProvider(CustomProvider):
    """Google Gemini provider (via OpenAI compatible endpoint)"""
    
    def __init__(
        self,
        api_key: str,
        base_url: str = None,
        model: str = "gemini-1.5-pro",
        max_tokens: int = 8000,
        temperature: float = 0.7
    ):
        # Default to Google AI Studio OpenAI compatible endpoint
        if not base_url:
            base_url = "https://generativelanguage.googleapis.com/v1beta/openai/"
            
        super().__init__(api_key, base_url, model, max_tokens, temperature)
    
    def get_provider_name(self) -> str:
        return "gemini"
