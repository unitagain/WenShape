"""
LLM Gateway / 大模型网关
Unified interface with retry, rate limiting, and cost tracking
统一接口，包含重试、限流和成本追踪
"""

import asyncio
import os
import time
from typing import List, Dict, Any, Optional
import app.config as app_config
from app.utils.logger import get_logger
from app.services.llm_config_service import llm_config_service
from app.llm_gateway.providers import (
    BaseLLMProvider,
    OpenAIProvider,
    AnthropicProvider,
    DeepSeekProvider,
    MockProvider,
    CustomProvider,
    QwenProvider,
    KimiProvider,
    GLMProvider,
    GeminiProvider,
    GrokProvider,
)

logger = get_logger(__name__)


class LLMGateway:
    """
    Unified LLM gateway with provider management
    统一的大模型网关，支持多提供商管理
    """
    
    def __init__(self):
        """Initialize gateway from profiles"""
        self.providers: Dict[str, BaseLLMProvider] = {}
        # We don't pre-initialize all providers anymore, or we initialize all profiles?
        # Let's initialize all valid profiles for cache
        self._init_profiles()
        
        # Retry configuration / 重试配置
        self.max_retries = 3
        self.retry_delays = [1, 2, 4]  # Exponential backoff / 指数退避
        
        # Cost tracking / 成本追踪
        self.total_tokens = 0
        self.total_requests = 0
    
    def _init_profiles(self) -> None:
        """Initialize LLM providers from stored profiles"""
        self.providers = {}
        
        # Always register Mock provider (no key needed)
        self.providers["mock"] = MockProvider()
        
        profiles = llm_config_service.get_profiles()
        for profile in profiles:
            try:
                provider_instance = self._create_provider_from_profile(profile)
                if provider_instance:
                    self.providers[profile["id"]] = provider_instance
            except Exception as e:
                logger.error(f"Failed to init profile {profile.get('name')}: {e}")

    def _create_provider_from_profile(self, profile: Dict[str, Any]) -> Optional[BaseLLMProvider]:
        provider_type = profile.get("provider")
        api_key = profile.get("api_key")
        
        # Mock handled separately, but if listed in profiles:
        if provider_type == "mock":
            return MockProvider()

        if not api_key and provider_type != "mock":
             # Some custom local LLMS might not need key, but generally we expect one or at least safe instantiation
             pass

        try:
            if provider_type == "openai":
                return OpenAIProvider(
                    api_key=api_key,
                    model=profile.get("model", "gpt-4o"),
                    max_tokens=profile.get("max_tokens", 8000),
                    temperature=profile.get("temperature", 0.7)
                )
            elif provider_type == "anthropic":
                return AnthropicProvider(
                    api_key=api_key,
                    model=profile.get("model", "claude-3-5-sonnet-20241022"),
                    max_tokens=profile.get("max_tokens", 8000),
                    temperature=profile.get("temperature", 0.7)
                )
            elif provider_type == "deepseek":
                return DeepSeekProvider(
                    api_key=api_key,
                    model=profile.get("model", "deepseek-chat"),
                    max_tokens=profile.get("max_tokens", 8000),
                    temperature=profile.get("temperature", 0.7)
                )
            elif provider_type == "qwen":
                return QwenProvider(
                    api_key=api_key,
                    base_url=profile.get("base_url"),
                    model=profile.get("model", "qwen-turbo"),
                    max_tokens=profile.get("max_tokens", 8000),
                    temperature=profile.get("temperature", 0.7)
                )
            elif provider_type == "kimi":
                return KimiProvider(
                    api_key=api_key,
                    base_url=profile.get("base_url"),
                    model=profile.get("model", "moonshot-v1-8k"),
                    max_tokens=profile.get("max_tokens", 8000),
                    temperature=profile.get("temperature", 0.7)
                )
            elif provider_type == "glm":
                return GLMProvider(
                    api_key=api_key,
                    base_url=profile.get("base_url"),
                    model=profile.get("model", "glm-4"),
                    max_tokens=profile.get("max_tokens", 8000),
                    temperature=profile.get("temperature", 0.7)
                )
            elif provider_type == "gemini":
                return GeminiProvider(
                    api_key=api_key,
                    base_url=profile.get("base_url"),
                    model=profile.get("model", "gemini-1.5-pro"),
                    max_tokens=profile.get("max_tokens", 8000),
                    temperature=profile.get("temperature", 0.7)
                )
            elif provider_type == "grok":
                return GrokProvider(
                    api_key=api_key,
                    base_url=profile.get("base_url"),
                    model=profile.get("model", "grok-beta"),
                    max_tokens=profile.get("max_tokens", 8000),
                    temperature=profile.get("temperature", 0.7)
                )
            elif provider_type == "custom":
                return CustomProvider(
                    api_key=api_key or "sk-custom",
                    base_url=profile.get("base_url", ""),
                    model=profile.get("model", "custom-model"),
                    max_tokens=profile.get("max_tokens", 8000),
                    temperature=profile.get("temperature", 0.7)
                )
        except Exception as e:
            logger.error(f"Error creating provider instance for {profile.get('name')}: {e}")
            return None
        return None
    
    async def chat(
        self,
        messages: List[Dict[str, str]],
        provider: Optional[str] = None, # This is now the profile_id!
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        retry: bool = True
    ) -> Dict[str, Any]:
        """
        Send chat request
        Args:
            provider: This is now the PROFILE ID, not just 'openai'
        """
        # If provider is None, fallback to default? Or raise error?
        # In new system, provider ID should be explicit or looked up via agent assignment
        
        # NOTE: existing code might pass 'openai' string. 
        # We should handle backward compatibility or ensure caller passes profile ID.
        # Actually, caller usually passes result of get_provider_for_agent()
        
        target_provider = None

        if provider in self.providers:
            target_provider = self.providers[provider]
        else:
            # Fallback: maybe it's a legacy string like 'openai'?
            # Try to find first profile of that type?
            for pid, p in self.providers.items():
                if hasattr(p, 'get_provider_name') and p.get_provider_name() == provider:
                    target_provider = p
                    break
             
            if not target_provider and "mock" in self.providers:
                # Last resort fallback to mock if available/debug?
                # For now raise error
                pass

        if not target_provider:
             raise ValueError(f"Profile/Provider '{provider}' not found.")
        
        # Execute with retry
        if retry:
            return await self._chat_with_retry(
                target_provider, messages, temperature, max_tokens
            )
        else:
            return await self._execute_chat(
                target_provider, messages, temperature, max_tokens
            )
    
    async def _chat_with_retry(
        self,
        provider: BaseLLMProvider,
        messages: List[Dict[str, str]],
        temperature: Optional[float],
        max_tokens: Optional[int]
    ) -> Dict[str, Any]:
        """Execute chat with exponential backoff retry"""
        last_exception = None
        
        for attempt in range(self.max_retries):
            try:
                return await self._execute_chat(
                    provider, messages, temperature, max_tokens
                )
            except Exception as e:
                last_exception = e
                # Logging...
                logger.error(f"LLM request error: {e}", exc_info=True)
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(self.retry_delays[attempt])
        
        raise last_exception
    
    async def _execute_chat(
        self,
        provider: BaseLLMProvider,
        messages: List[Dict[str, str]],
        temperature: Optional[float],
        max_tokens: Optional[int]
    ) -> Dict[str, Any]:
        """Execute single chat request"""
        start_time = time.time()
        response = await provider.chat(messages, temperature=temperature, max_tokens=max_tokens)
        elapsed_time = time.time() - start_time
        
        self.total_requests += 1
        self.total_tokens += response.get("usage", {}).get("total_tokens", 0)
        
        response["provider"] = provider.get_provider_name()
        response["elapsed_time"] = elapsed_time
        return response
    
    def get_stats(self) -> Dict[str, Any]:
        """Get gateway statistics"""
        return {
            "total_requests": self.total_requests,
            "total_tokens": self.total_tokens,
            "profiles_loaded": list(self.providers.keys())
        }
    
    def get_provider_for_agent(self, agent_name: str) -> str:
        """
        Get configured PROFILE ID for specific agent
        """
        assignments = llm_config_service.get_assignments()
        profile_id = assignments.get(agent_name)
        
        if profile_id and profile_id in self.providers:
            return profile_id
            
        # Fallback if assignment is invalid or empty
        # Return first available profile?
        if self.providers:
            return list(self.providers.keys())[0]
            
        return "mock" # Absolute fallback
    
    def get_temperature_for_agent(self, agent_name: str) -> float:
        """
        Get configured temperature (from assigned profile)
        """
        profile_id = self.get_provider_for_agent(agent_name)
        # However, we can't easily peek into provider instance config without casting
        # But we can look at the raw profile data
        profile = llm_config_service.get_profile_by_id(profile_id)
        if profile:
            return profile.get("temperature", 0.7)
        return 0.7


# Global gateway instance / 全局网关实例
_gateway_instance: Optional[LLMGateway] = None


def get_gateway() -> LLMGateway:
    """Get or create global gateway instance"""
    global _gateway_instance
    if _gateway_instance is None:
        _gateway_instance = LLMGateway()
    return _gateway_instance


def reset_gateway() -> None:
    """Reset global gateway instance so new config takes effect / 重置全局网关实例以应用新配置"""
    global _gateway_instance
    _gateway_instance = None
