# -*- coding: utf-8 -*-
"""
文枢 WenShape - 深度上下文感知的智能体小说创作系统
WenShape - Deep Context-Aware Agent-Based Novel Writing System

Copyright © 2025-2026 WenShape Team
License: PolyForm Noncommercial License 1.0.0

模块说明 / Module Description:
  路径安全工具 - 在使用用户输入的标识符之前进行清理和验证
  Path Safety Utilities - Sanitize user-supplied identifiers before using them in file paths.
"""

import re
from pathlib import Path

from app.error_contract import DomainError, ErrorCategory

# Allow: word characters (includes CJK via \w with re.UNICODE), hyphens, dots (not leading)
# 允许：单词字符（包括通过re.UNICODE的CJK）、连字符、点（不在开头）
_SAFE_ID_RE = re.compile(r"^[\w][\w\-\.]*$", re.UNICODE)

# Characters that are dangerous in file paths
# 文件路径中危险的字符
_UNSAFE_CHARS_RE = re.compile(r"[^\w\u4e00-\u9fff\-]", re.UNICODE)


# Windows 保留设备名：即使带扩展名（如 "CON.txt"）也会被系统特殊对待。
# Windows reserved device names: still special-cased even with an extension.
_WINDOWS_RESERVED_NAMES = frozenset(
    {"CON", "PRN", "AUX", "NUL"} | {f"COM{i}" for i in range(1, 10)} | {f"LPT{i}" for i in range(1, 10)}
)


class UnsafeIdentifierError(DomainError, ValueError):
    """
    标识符未通过路径安全校验（拒绝，不改写）

    Identifier failed path-safety validation (rejected, never rewritten).

    继承 DomainError 以复用既有错误合同：``classify_exception`` 直接返回本实例，
    ``status_code_for`` 映射为 400，``safe_detail`` 保证响应不泄露真实文件系统路径。
    同时继承 ValueError，使既有 ``except ValueError`` 调用点（如 routers/projects.py）
    的行为保持不变——MRO 中 DomainError 在前，分类逻辑不受影响。
    """

    default_code = "unsafe_identifier"
    default_category = ErrorCategory.VALIDATION


def validate_identifier(raw: str, max_length: int = 64, *, field: str = "id") -> str:
    """
    校验标识符可安全用作单一路径段，不通过则拒绝

    Validate that an identifier is safe as a single path segment; reject otherwise.

    与 :func:`sanitize_id` 的关键区别——**本函数只做「通过或拒绝」，绝不改写输入**。
    这个区别是安全性的核心：``sanitize_id("../../etc")`` 返回 ``"etc"``，若用它来
    「校验」外部传入的既有标识符，越界请求不会被拒绝，而会静默重定向到另一个合法
    目录，读写落到错误的项目上——比直接报错更难被发现。

    职责边界：
    - :func:`sanitize_id` —— 由用户自由文本**新建**标识符时使用（改写是期望行为）。
    - :func:`validate_identifier` —— **校验**外部传入的既有标识符时使用（改写是漏洞）。

    Args:
        raw: 待校验的标识符 / Identifier to validate
        max_length: 最大长度 / Maximum length
        field: 进入错误码的字段名 / Field name used in the error code

    Returns:
        原样返回的标识符，未做任何修改 / The identifier, returned verbatim

    Raises:
        UnsafeIdentifierError: 任一规则不通过 / If any rule fails

    Example:
        >>> validate_identifier("project-2024")
        'project-2024'
        >>> validate_identifier("../../etc")
        # Raises UnsafeIdentifierError（而非改写为 "etc"）
    """

    def _reject(reason: str) -> "UnsafeIdentifierError":
        # 错误码只含字段名与原因，不回显 raw 本身（避免把攻击载荷反射给客户端）。
        return UnsafeIdentifierError(
            f"unsafe_{field}:{reason}",
            code=f"unsafe_{field}",
            metadata={"reason": reason},
        )

    if not isinstance(raw, str) or not raw:
        raise _reject("empty")
    if len(raw) > max_length:
        raise _reject("too_long")
    # 首尾空白与结尾点：Windows 落盘时会静默裁掉，导致「校验的名字」与「实际的名字」不一致。
    if raw != raw.strip() or raw.endswith("."):
        raise _reject("padded")
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in raw):
        raise _reject("control_char")
    if "/" in raw or "\\" in raw:
        raise _reject("separator")
    # 冒号同时覆盖 Windows 盘符（``C:``）与 NTFS 备用数据流（``name:stream``）。
    if ":" in raw:
        raise _reject("drive_or_stream")
    if ".." in raw:
        raise _reject("traversal")
    if raw.startswith("."):
        raise _reject("dot_prefix")
    if raw.split(".", 1)[0].upper() in _WINDOWS_RESERVED_NAMES:
        raise _reject("reserved_name")
    return raw


def sanitize_id(raw: str, max_length: int = 64) -> str:
    """
    清理用户提供的标识符以安全用于文件路径

    Sanitize a user-supplied identifier for safe use in file paths.

    ⚠️ 本函数**会改写输入**，只可用于「由自由文本新建标识符」。校验外部传入的
    既有标识符请用 :func:`validate_identifier`——用本函数做校验会把越界输入
    静默改写为另一个合法标识符（见该函数 docstring）。

    Sanitize a user-supplied identifier for safe use in file paths.

    清理规则：
    - 用 '_' 替换不安全字符
    - 拒绝空值、点开头、目录遍历尝试
    - 截断到最大长度

    Sanitization rules:
    - Replace unsafe characters with '_'
    - Reject empty / dot-prefixed / traversal attempts
    - Truncate to max_length

    Args:
        raw: 原始输入 / Raw input
        max_length: 最大长度 / Maximum length

    Returns:
        清理后的标识符 / Sanitized identifier

    Raises:
        ValueError: 如果输入无法清理为有效ID / If input cannot be sanitized to valid ID

    Example:
        >>> sanitize_id("project-2024")
        "project-2024"
        >>> sanitize_id("../../../etc/passwd")
        "etc_passwd"
        >>> sanitize_id("user input@#$%")
        "user_input____"
    """
    if not raw or not isinstance(raw, str):
        raise ValueError("ID必须是非空字符串 / ID must be a non-empty string")

    text = raw.strip()
    if not text:
        raise ValueError("ID必须是非空字符串 / ID must be a non-empty string")

    # Replace spaces with underscores first
    # 首先用下划线替换空格
    text = text.replace(" ", "_")

    # Remove any path traversal attempts
    # 移除任何目录遍历尝试
    text = text.replace("..", "").replace("/", "").replace("\\", "")

    # Replace remaining unsafe characters
    # 替换剩余的不安全字符
    text = _UNSAFE_CHARS_RE.sub("_", text)

    # Strip leading dots/underscores
    # 移除开头的点/下划线
    text = text.lstrip("._")

    # Collapse multiple underscores
    # 合并多个下划线
    text = re.sub(r"_+", "_", text)

    # Truncate
    # 截断
    text = text[:max_length]

    # Strip trailing underscores/dots
    # 移除末尾的下划线/点
    text = text.rstrip("._")

    if not text:
        raise ValueError(f"无法从输入清理ID / Cannot sanitize ID from input: {raw!r}")

    return text


def validate_path_within(child: Path, parent: Path) -> Path:
    """
    验证child路径在parent目录内

    Validate that *child* resolves to a path inside *parent*.

    Returns the resolved child path.

    Args:
        child: 子路径 / Child path
        parent: 父路径 / Parent path

    Returns:
        解析后的子路径 / Resolved child path

    Raises:
        UnsafeIdentifierError: 如果子路径逃逸出父目录 / If the child escapes the parent directory

    Example:
        >>> validate_path_within(Path("data/project1"), Path("data"))
        PosixPath('data/project1')
        >>> validate_path_within(Path("../etc"), Path("data"))
        # Raises UnsafeIdentifierError
    """
    resolved_parent = parent.resolve()
    resolved_child = child.resolve()

    # 用 is_relative_to 而非字符串前缀比较：``/data/foo-backup`` 不应被判定为
    # ``/data/foo`` 的内部路径，而 ``startswith`` 会误判为通过。
    # Use is_relative_to instead of string prefix matching: "/data/foo-backup"
    # must not count as inside "/data/foo", which startswith would wrongly allow.
    if resolved_child != resolved_parent and not resolved_child.is_relative_to(resolved_parent):
        raise UnsafeIdentifierError(
            "path_escapes_data_dir",
            code="path_escapes_data_dir",
        )

    return resolved_child
