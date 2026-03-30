"""
中文说明：该模块为 WenShape 后端组成部分，详细行为见下方英文说明。

Moegirl-specific crawler helper functions.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, quote, unquote, urldefrag, urljoin, urlparse

from bs4 import BeautifulSoup


def normalize_url(url: str) -> str:
    if not url:
        return ""
    normalized, _ = urldefrag(url.strip())
    return normalized


def is_moegirl_domain(netloc: str) -> bool:
    host = (netloc or "").lower()
    return "moegirl.org" in host or "moegirl.org.cn" in host


def moegirl_article_title_from_url(parsed) -> Optional[str]:
    query_params = parse_qs(parsed.query or "")
    title = query_params.get("title", [None])[0]
    if title:
        return unquote(title).strip() or None
    if query_params.get("curid", [None])[0]:
        return None
    path_parts = parsed.path.strip("/").split("/")
    if not path_parts or not path_parts[0]:
        return None
    if path_parts[0] == "wiki" and len(path_parts) > 1:
        return unquote("/".join(path_parts[1:])).strip() or None
    if path_parts[0] in {"api.php", "index.php"}:
        return None
    return unquote(parsed.path.strip("/")).strip() or None


def build_moegirl_page_url(title: str) -> str:
    safe = quote(str(title or "").replace(" ", "_"), safe="")
    return f"https://mzh.moegirl.org.cn/index.php?title={safe}"


def build_moegirl_raw_url(title: str, base: str) -> str:
    safe = quote(str(title or "").replace(" ", "_"), safe="")
    return f"{base}/index.php?title={safe}&action=raw"


def is_mediawiki_namespace_title(title: str) -> bool:
    t = str(title or "").strip()
    if not t or ":" not in t:
        return False
    prefix = t.split(":", 1)[0].strip().lower()
    if prefix in {"special", "file", "talk", "template", "user", "help", "category", "module", "mediawiki"}:
        return True
    if prefix in {"特殊", "文件", "讨论", "模板", "用户", "帮助", "分类", "模块", "媒体维基"}:
        return True
    return False


def extract_moegirl_list_links_from_html(
    content_root: BeautifulSoup,
    base_url: str,
    max_links: int,
) -> List[Dict[str, str]]:
    links: List[Dict[str, str]] = []
    seen = set()
    if not content_root:
        return links

    for anchor in content_root.select("li a[href]")[: max_links * 10]:
        href = str(anchor.get("href") or "").strip()
        if not href or href.startswith("#"):
            continue
        abs_url = normalize_url(urljoin(base_url, href))
        if not abs_url:
            continue
        parsed = urlparse(abs_url)
        if not is_moegirl_domain(parsed.netloc):
            continue
        title = moegirl_article_title_from_url(parsed)
        if not title or is_mediawiki_namespace_title(title):
            continue

        final_url = build_moegirl_page_url(title)
        if final_url in seen:
            continue
        seen.add(final_url)
        links.append({"title": title, "url": final_url})
        if len(links) >= max_links:
            break
    return links


def extract_moegirl_outgoing_links_from_html(
    content_root: BeautifulSoup,
    base_url: str,
    cap: int,
) -> List[Dict[str, str]]:
    if not content_root:
        return []

    links: List[Dict[str, str]] = []
    seen = set()

    def is_noise_anchor(anchor) -> bool:
        classes = anchor.get("class") or []
        if isinstance(classes, str):
            classes = [classes]
        cls_join = " ".join([str(c) for c in classes]).lower()
        if "new" in cls_join or "external" in cls_join:
            return True

        noise_class_patterns = [
            "navbox",
            "vertical-navbox",
            "toc",
            "catlinks",
            "mw-references-wrap",
            "reference",
            "reflist",
            "metadata",
            "ambox",
            "sistersitebox",
            "noprint",
            "portal",
        ]
        for parent in anchor.parents:
            if getattr(parent, "name", None) is None:
                continue
            if parent.name in {"nav", "footer"}:
                return True
            if parent.get("role") == "navigation":
                return True
            pcls = parent.get("class") or []
            if isinstance(pcls, str):
                pcls = [pcls]
            pcls_join = " ".join([str(c) for c in pcls]).lower()
            if any(pattern in pcls_join for pattern in noise_class_patterns):
                return True
        return False

    def signal_score(anchor) -> int:
        for parent in anchor.parents:
            if getattr(parent, "name", None) is None:
                continue
            if parent.name == "table":
                return 3
            if parent.name in {"p", "li", "dd", "dt", "h1", "h2", "h3", "h4", "h5", "h6"}:
                return 2
            pcls = parent.get("class") or []
            if isinstance(pcls, str):
                pcls = [pcls]
            pcls_join = " ".join([str(c) for c in pcls]).lower()
            if "infobox" in pcls_join or "wikitable" in pcls_join or "basic-info" in pcls_join:
                return 3
        return 0

    candidates: List[Dict[str, Any]] = []
    for anchor in content_root.find_all("a", href=True):
        if is_noise_anchor(anchor):
            continue
        href = str(anchor.get("href") or "").strip()
        if not href or href.startswith("#"):
            continue
        abs_url = normalize_url(urljoin(base_url, href))
        if not abs_url:
            continue

        parsed = urlparse(abs_url)
        if not is_moegirl_domain(parsed.netloc):
            continue

        title = moegirl_article_title_from_url(parsed)
        if not title:
            title_attr = str(anchor.get("title") or "").strip()
            if title_attr and not is_mediawiki_namespace_title(title_attr):
                title = title_attr
        if not title:
            text_title = anchor.get_text(" ", strip=True)
            if 1 < len(text_title) <= 30 and not is_mediawiki_namespace_title(text_title):
                title = text_title
        if not title or is_mediawiki_namespace_title(title):
            continue

        final_url = build_moegirl_page_url(title)
        if final_url in seen:
            continue
        seen.add(final_url)
        score = signal_score(anchor)
        if score <= 0:
            continue
        candidates.append({"title": title, "url": final_url, "score": score})

    candidates.sort(key=lambda item: (-int(item.get("score") or 0), item.get("title") or ""))
    for item in candidates[:cap]:
        links.append({"title": item["title"], "url": item["url"]})
    return links


def extract_moegirl_links_from_raw(raw_text: str, cap: int) -> List[Dict[str, str]]:
    links: List[Dict[str, str]] = []
    seen = set()
    for match in re.finditer(r"\[\[([^\]\|#]+)(?:#[^\]\|]*)?(?:\|[^\]]*)?\]\]", str(raw_text or "")):
        title = str(match.group(1) or "").strip()
        if not title or is_mediawiki_namespace_title(title):
            continue
        page_url = build_moegirl_page_url(title)
        if page_url in seen:
            continue
        seen.add(page_url)
        links.append({"title": title, "url": page_url})
        if len(links) >= cap:
            break
    return links


def normalize_raw_wikitext(text: str) -> str:
    content = str(text or "")
    content = re.sub(r"<!--.*?-->", "", content, flags=re.S)
    content = re.sub(r"<ref[^>]*>.*?</ref>", "", content, flags=re.S | re.I)
    content = re.sub(r"<ref[^/>]*/>", "", content, flags=re.I)
    content = re.sub(r"\{\{[^{}]{0,300}\}\}", "", content)
    content = re.sub(r"\[\[([^\]\|#]+)(?:#[^\]\|]*)?\|([^\]]+)\]\]", r"\2", content)
    content = re.sub(r"\[\[([^\]\|#]+)(?:#[^\]\|]*)?\]\]", r"\1", content)
    content = re.sub(r"\[https?://[^\s\]]+\s+([^\]]+)\]", r"\1", content)
    content = re.sub(r"\[https?://[^\s\]]+\]", "", content)
    content = re.sub(r"(?m)^\s*=+\s*(.*?)\s*=+\s*$", r"\1", content)
    content = re.sub(r"\n{3,}", "\n\n", content)
    return content.strip()


def merge_link_lists(primary: List[Dict[str, str]], secondary: List[Dict[str, str]], cap: int) -> List[Dict[str, str]]:
    merged: List[Dict[str, str]] = []
    seen = set()

    def add(items: List[Dict[str, str]]) -> None:
        for item in items or []:
            if len(merged) >= cap:
                return
            if not isinstance(item, dict):
                continue
            url = str(item.get("url") or "").strip()
            title = str(item.get("title") or "").strip()
            if not url or not title:
                continue
            if url in seen:
                continue
            seen.add(url)
            merged.append({"title": title, "url": url})

    add(primary)
    add(secondary)
    return merged
