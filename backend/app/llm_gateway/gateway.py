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
from app.llm_gateway.errors import classify_error, get_retry_delay
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
        self._ensure_mock_provider()

        # Retry configuration / 重试配置
        self.max_retries = 5  # Increased from 3 to 5
        self.retry_delays = [1, 2, 4, 8, 16]  # Exponential backoff / 指数退避
        self.max_retry_delay = 60.0  # Maximum delay cap / 最大延迟上限

        # Cost tracking / 成本追踪
        self.total_tokens = 0
        self.total_requests = 0

    def _is_mock_mode(self) -> bool:
        """
        Whether the system should run in mock/demo mode.

        In mock mode, we must not require any persisted LLM profiles/assignments,
        otherwise the app becomes unusable on first run (fresh checkout / packaged build).
        """
        try:
            return str(getattr(app_config.settings, "wenshape_llm_provider", "") or "").strip().lower() == "mock"
        except Exception:
            return str(os.getenv("WENSHAPE_LLM_PROVIDER", "") or "").strip().lower() == "mock"

    def _ensure_mock_provider(self) -> None:
        """Ensure mock provider exists when running in mock mode or as fallback."""
        if "mock" not in self.providers:
            self.providers["mock"] = MockProvider()
    
    def _init_profiles(self) -> None:
        """Initialize LLM providers from stored profiles"""
        self.providers = {}

        profiles = llm_config_service.get_profiles()
        for profile in profiles:
            try:
                provider_instance = self._create_provider_from_profile(profile)
                if provider_instance:
                    self.providers[profile["id"]] = provider_instance
            except Exception as e:
                logger.error("Failed to init profile %s: %s", profile.get('name'), e)

    def _try_load_profile_by_id(self, profile_id: str) -> bool:
        """
        Ensure a profile is loaded into provider cache.

        背景：网关实例可能被长时间持有（例如 orchestrator 缓存了 gateway），
        但用户在运行期新增/修改了 LLM 配置与分配。此处做一次“按需加载”，
        避免出现“已分配但未加载”的误报。
        """
        if not profile_id:
            return False
        if profile_id in self.providers:
            return True

        profile = llm_config_service.get_profile_by_id(profile_id)
        if not profile:
            return False

        try:
            provider_instance = self._create_provider_from_profile(profile)
            if not provider_instance:
                return False
            self.providers[profile_id] = provider_instance
            return True
        except Exception as e:
            logger.error("Failed to lazy-load profile id=%s: %s", profile_id, e)
            return False

    def _create_provider_from_profile(self, profile: Dict[str, Any]) -> Optional[BaseLLMProvider]:
        provider_type = profile.get("provider")
        api_key = profile.get("api_key")
        
        if not api_key:
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
                    model=profile.get("model", "gemini-2.5-flash"),
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
            logger.error("Error creating provider instance for %s: %s", profile.get('name'), e)
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

        if provider and provider not in self.providers:
            # 运行期新增 profile 的兼容：按需加载一次
            self._try_load_profile_by_id(provider)

        if provider in self.providers:
            target_provider = self.providers[provider]
        else:
            # Fallback: maybe it's a legacy string like 'openai'?
            # Try to find first profile of that type?
            for pid, p in self.providers.items():
                if hasattr(p, 'get_provider_name') and p.get_provider_name() == provider:
                    target_provider = p
                    break
             
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
        """
        Execute chat with intelligent retry based on error classification.
        基于错误分类的智能重试执行聊天。

        - Non-retryable errors (auth, invalid request) fail immediately
        - Retryable errors (timeout, connection, server) use exponential backoff
        """
        last_exception = None

        for attempt in range(self.max_retries):
            try:
                return await self._execute_chat(
                    provider, messages, temperature, max_tokens
                )
            except Exception as e:
                last_exception = e

                # Classify the error
                is_retryable, reason = classify_error(e)

                if not is_retryable:
                    # Non-retryable error - fail immediately
                    logger.error(
                        "LLM non-retryable error (reason=%s): %s",
                        reason, e, exc_info=True
                    )
                    raise

                # Retryable error - log and retry with backoff
                logger.warning(
                    "LLM retryable error (attempt=%d/%d, reason=%s): %s",
                    attempt + 1, self.max_retries, reason, e
                )

                if attempt < self.max_retries - 1:
                    delay = get_retry_delay(
                        attempt,
                        self.retry_delays,
                        self.max_retry_delay
                    )
                    logger.info("Retrying in %.1f seconds...", delay)
                    await asyncio.sleep(delay)

        # All retries exhausted
        logger.error(
            "LLM request failed after %d retries: %s",
            self.max_retries, last_exception
        )
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
        try:
            usage = response.get("usage", {})
            logger.info(
                "LLM chat completed provider=%s model=%s elapsed_ms=%s prompt_tokens=%s completion_tokens=%s",
                response.get("provider"),
                response.get("model"),
                int(elapsed_time * 1000),
                usage.get("prompt_tokens"),
                usage.get("completion_tokens"),
            )
        except Exception:
            pass
        return response
    
    def get_stats(self) -> Dict[str, Any]:
        """Get gateway statistics"""
        return {
            "total_requests": self.total_requests,
            "total_tokens": self.total_tokens,
            "profiles_loaded": list(self.providers.keys())
        }
    
    async def stream_chat(
        self,
        messages: List[Dict[str, str]],
        provider: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None
    ):
        """
        Stream chat response token by token
        流式输出聊天响应
        
        Args:
            messages: List of messages / 消息列表
            provider: Profile ID / 配置文件ID
            temperature: Override temperature / 覆盖温度
            max_tokens: Override max tokens / 覆盖最大token数
            
        Yields:
            String chunks as they arrive from the LLM
        """
        # Resolve provider
        target_provider = None
        if provider and provider not in self.providers:
            self._try_load_profile_by_id(provider)
        if provider in self.providers:
            target_provider = self.providers[provider]
        else:
            for pid, p in self.providers.items():
                if hasattr(p, 'get_provider_name') and p.get_provider_name() == provider:
                    target_provider = p
                    break
        
        if not target_provider:
            raise ValueError(f"Profile/Provider '{provider}' not found.")
        
        # Delegate to provider's stream_chat
        async for chunk in target_provider.stream_chat(messages, temperature, max_tokens):
            yield chunk
    
    def get_provider_for_agent(self, agent_name: str) -> str:
        """
        Get configured PROFILE ID for specific agent
        """
        if self._is_mock_mode():
            self._ensure_mock_provider()
            return "mock"

        assignments = llm_config_service.get_assignments()
        profile_id = assignments.get(agent_name)

        if not profile_id:
            if "mock" in self.providers:
                return "mock"
            raise ValueError(f"No LLM profile assigned for agent '{agent_name}'.")

        if profile_id not in self.providers:
            # 运行期修改 assignments/profile 时，orchestrator 可能仍在复用旧 gateway 实例；
            # 这里做一次按需加载，避免误判为“未加载”。
            self._try_load_profile_by_id(profile_id)

        if profile_id not in self.providers:
            raise ValueError(f"Assigned LLM profile '{profile_id}' not loaded for agent '{agent_name}'.")

        return profile_id
    
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

    def get_profile_for_agent(self, agent_name: str) -> Optional[Dict[str, Any]]:
        """
        Get full profile config for specific agent
        获取特定 Agent 的完整配置
        """
        try:
            profile_id = self.get_provider_for_agent(agent_name)
            return llm_config_service.get_profile_by_id(profile_id)
        except ValueError:
            return None

    def get_model_for_agent(self, agent_name: str) -> Optional[str]:
        """
        Get model name for specific agent
        获取特定 Agent 使用的模型名称
        """
        profile = self.get_profile_for_agent(agent_name)
        if profile:
            return profile.get("model")
        return None


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
