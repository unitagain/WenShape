"""
AI Studio (PaddlePaddle) Provider / 飞桨 AI Studio 适配器
Compatible with OpenAI API / 兼容 OpenAI API
"""

from app.llm_gateway.providers.custom_provider import CustomProvider


class AIStudioProvider(CustomProvider):
    """PaddlePaddle AI Studio provider / 飞桨 AI Studio 提供商"""

    def __init__(
        self,
        api_key: str,
        base_url: str = None,
        model: str = "ernie-5.0-thinking-preview",
        max_tokens: int = 8000,
        temperature: float = 0.7,
    ):
        if not base_url:
            base_url = "https://aistudio.baidu.com/llm/lmapi/v3"
        super().__init__(api_key, base_url, model, max_tokens, temperature)

    def get_provider_name(self) -> str:
        return "aistudio"
