# -*- coding: utf-8 -*-
"""
文枢 WenShape - 深度上下文感知的智能体小说创作系统
WenShape - Deep Context-Aware Agent-Based Novel Writing System

Copyright © 2025-2026 WenShape Team
License: PolyForm Noncommercial License 1.0.0

模块说明 / Module Description:
  可插拔嵌入后端（Phase 4）—— 让检索从"纯词法"升级为"语义 + 词法"混合。
  默认启用（config.retrieval.embeddings.enabled=true）；缺 fastembed 库 / 模型未就位时
  运行时自动降级为纯词法（返回 None），不报错。可选本地 ONNX 模型（bge-small-zh）或 provider API。
  Pluggable embeddings backend: activates semantic retrieval. On by default;
  gracefully falls back to lexical-only (None) when fastembed/model is unavailable.
"""

from __future__ import annotations

import asyncio
import math
from abc import ABC, abstractmethod
from pathlib import Path
from typing import List, Optional

from app.config import get_settings
from app.utils.logger import get_logger

logger = get_logger(__name__)


def cosine_similarity(a: List[float], b: List[float]) -> float:
    """余弦相似度；任一为空/维度不符/零向量则返回 0。"""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = na = nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na <= 0.0 or nb <= 0.0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


class EmbeddingsBackend(ABC):
    """嵌入后端统一接口。"""

    @abstractmethod
    async def embed(self, texts: List[str]) -> List[List[float]]:
        """把一批文本编码为向量列表（顺序对应）。"""
        raise NotImplementedError


class OnnxEmbedder(EmbeddingsBackend):
    """基于本地 ONNX 模型的中文嵌入（默认 bge-small-zh-v1.5）。

    懒加载 fastembed（内部 onnxruntime）；缺库/缺模型时在工厂处被捕获并降级为 None。
    模型由 build_release/sidecar 随附（离线），或首次联网下载到 cache_dir（见 Phase 4c）。
    """

    # bge-small-zh-v1.5 的输入窗口（含特殊 token）；tokenizer 不可用时用于保守估算。
    DEFAULT_MAX_TOKENS = 512

    def __init__(self, model_name: str = "BAAI/bge-small-zh-v1.5", cache_dir: Optional[str] = None):
        self.model_name = model_name
        self.cache_dir = cache_dir
        self._model = None
        self._tokenizer = None
        self._unavailable = False  # 一次性短路：缺库/缺模型后不再反复尝试加载（避免每次检索都触发 ImportError）

    def _ensure(self):
        if self._unavailable:
            raise RuntimeError("embeddings backend unavailable (previous load failed)")
        if self._model is None:
            try:
                from fastembed import TextEmbedding  # 懒加载：缺库则抛 ImportError，由工厂/调用方降级

                self._model = TextEmbedding(model_name=self.model_name, cache_dir=self.cache_dir)
            except Exception:
                self._unavailable = True  # 标记不可用 → 后续直接短路，select_engine 降级为词法
                raise
        return self._model

    def _ensure_tokenizer(self):
        """尽力获取 tokenizer（C1/F09）；不可用时返回 None（调用方保守估算）。"""
        if self._unavailable:
            return None
        if self._tokenizer is None:
            try:
                model = self._ensure()
                # fastembed TextEmbedding 暴露 tokenize（不同版本为方法或属性）。
                tokenize = getattr(model, "tokenize", None)
                if callable(tokenize):
                    self._tokenizer = tokenize
                elif tokenize is not None:
                    self._tokenizer = tokenize
            except Exception:
                self._tokenizer = None
        return self._tokenizer

    def count_tokens(self, text: str) -> Optional[int]:
        """用真实 tokenizer 计数（含特殊 token 占位近似）；不可用返回 None。

        近似规则：tokenizer 产出 input_ids 列表时取长度并加 2（[CLS]/[SEP]）。
        """
        tokenize = self._ensure_tokenizer()
        if tokenize is None:
            return None
        try:
            result = tokenize([str(text or "")])
            ids = result[0] if isinstance(result, list) and result else None
            if hasattr(ids, "input_ids"):
                return int(len(ids.input_ids))
            if ids is not None and hasattr(ids, "__len__"):
                return int(len(ids)) + 2
        except Exception:
            return None
        return None

    def max_input_tokens(self) -> int:
        """模型输入窗口（token，含特殊 token）；未知时返回保守默认。"""
        return self.DEFAULT_MAX_TOKENS

    def space_fingerprint(self) -> str:
        """向量空间指纹（C1/F10）：同文本在不同模型/空间下不可复用缓存向量。

        只含模型身份与窗口：同模型重复加载指纹不变（缓存仍命中）；换模型即变。
        """
        digest_source = f"{self.model_name}|window={self.max_input_tokens()}"
        import hashlib

        return hashlib.sha1(digest_source.encode("utf-8")).hexdigest()[:12]

    async def embed(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
        model = self._ensure()

        def _run() -> List[List[float]]:
            # fastembed.embed 为同步生成器；放线程池避免阻塞事件循环
            return [list(map(float, vec)) for vec in model.embed(list(texts))]

        return await asyncio.to_thread(_run)


def resolve_model_cache_dir(value: Optional[str]) -> str:
    """Resolve model cache paths against the writable WenShape DATA_DIR."""
    raw = str(value or "models").strip() or "models"
    path = Path(raw).expanduser()
    if path.is_absolute():
        return str(path.resolve())
    return str((Path(get_settings().data_dir) / path).resolve())


def create_embeddings_backend(config) -> Optional[EmbeddingsBackend]:
    """按配置创建嵌入后端；未启用或初始化失败 → 返回 None（调用方降级为纯词法）。

    默认启用（enabled 缺省视为 True，与 config.yaml 一致）；仅显式 enabled:false 才禁用。
    """
    cfg = (config.get("retrieval", {}) or {}).get("embeddings", {}) or {}
    if not cfg.get("enabled", True):
        return None
    backend = str(cfg.get("backend", "onnx")).lower()
    try:
        if backend == "onnx":
            return OnnxEmbedder(
                model_name=str(cfg.get("model", "BAAI/bge-small-zh-v1.5")),
                cache_dir=resolve_model_cache_dir(cfg.get("cache_dir")),
            )
        # backend == "api" 由 Phase 4b 接入（走 LLM 网关的 embeddings 端点）
        logger.info("Embeddings backend '%s' not yet wired; semantic disabled.", backend)
    except Exception as exc:
        logger.warning("Embeddings backend init failed (%s); semantic retrieval disabled: %s", backend, exc)
    return None
