"""
Crawler Service for Fanfiction Feature
Scrapes Wiki pages and extracts content using multiple strategies:
1. MediaWiki API (for Wikipedia, Fandom, Huiji, etc.)
2. Direct HTML scraping (fallback)
"""

import requests
from bs4 import BeautifulSoup
import asyncio
import aiohttp
import re
from typing import List, Dict, Optional
from urllib.parse import urljoin, unquote, quote, urlparse
import logging
from .wiki_parser import wiki_parser


class CrawlerService:
    """Service for scraping Wiki pages"""
    
    def __init__(self):
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
        self.session = requests.Session()
        self.session.headers.update(self.headers)
    
    def scrape_page(self, url: str) -> Dict[str, any]:
        """
        Scrape a Wiki page and extract main content
        Uses API when available, falls back to HTML scraping
        """
        try:
            parsed = urlparse(url)
            domain = parsed.netloc.lower()
            
            # Route to appropriate scraper
            if 'fandom.com' in domain:
                result = self._scrape_fandom(url, parsed)
            elif 'moegirl.org' in domain:
                result = self._scrape_moegirl(url, parsed)
            elif 'wikipedia.org' in domain:
                result = self._scrape_wikipedia(url, parsed)
            elif 'huijiwiki.com' in domain or 'wiki' in domain:
                result = self._scrape_mediawiki_api(url, parsed)
            else:
                # Fallback to HTML scraping
                result = self._scrape_html(url)
            
            # Safety net: ensure we always return SOMETHING useful
            if result.get('success', False):
                # If successful but both content and links are empty, add fallback info
                if not result.get('content') and not result.get('links'):
                    result['content'] = f"Page Title: {result.get('title', 'Unknown')}\n\n该页面可能需要手动访问浏览。"
                    result['links'] = []
            
            return result
                
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'url': url,
                'content': '',
                'links': []
            }
    
    def _scrape_moegirl(self, url: str, parsed) -> Dict:
        """Scrape Moegirl using MediaWiki API (parse action)"""
        # Moegirl URL formats:
        # https://zh.moegirl.org.cn/Title
        # https://zh.moegirl.org.cn/index.php?title=Title
        
        from urllib.parse import parse_qs, unquote
        
        article_name = None
        
        # Check query params first
        if 'index.php' in parsed.path:
            query_params = parse_qs(parsed.query)
            if 'title' in query_params:
                article_name = query_params['title'][0]
        
        # Check path
        if not article_name:
            path_parts = parsed.path.strip('/').split('/')
            # Handle /wiki/Title or just /Title
            if len(path_parts) > 0:
                if path_parts[0] == 'wiki' and len(path_parts) > 1:
                    article_name = '/'.join(path_parts[1:])
                elif path_parts[0] != 'index.php':
                    article_name = parsed.path.strip('/')
        
        if article_name:
            article_name = unquote(article_name)

        if not article_name:
            return self._scrape_html(url)
            
        api_base = f"{parsed.scheme}://{parsed.netloc}"
        api_url = f"{api_base}/api.php"
        
        # Use 'parse' action
        params = {
            'action': 'parse',
            'page': article_name,
            'prop': 'text|categories',
            'format': 'json',
            'redirects': '1'  # Follow redirects
        }
        
        try:
            # Custom headers for Moegirl
            headers = self.headers.copy()
            headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            
            # Explicit encoding for Chinese content
            response = self.session.get(api_url, params=params, headers=headers, timeout=15)
            response.raise_for_status()
            
            # Force UTF-8 for JSON API responses (MediaWiki returns UTF-8 JSON)
            response.encoding = 'utf-8'
            
            try:
                data = response.json()
            except Exception as json_err:
                print(f"[Crawler] Moegirl JSON parse error: {json_err}")
                return self._scrape_html(url)
            
            if 'error' in data:
                return self._scrape_html(url)
            
            parse_data = data.get('parse', {})
            title = parse_data.get('title', 'Untitled')
            html_content = parse_data.get('text', {}).get('*', '')
            
            # Moegirl specific: Remove hidden content and styling
            if html_content:
                soup = BeautifulSoup(html_content, 'lxml')
                
                # 1. Extract links (BEFORE cleaning text, so we get Navboxes)
                links = self._extract_links(soup, url)
                
                # Remove Moegirl specific hidden elements
                for hidden in soup.find_all(class_='heimu'):
                    pass 
                
                content = self._extract_text_from_soup(soup)
            else:
                content = ''
                links = []
            
            # Fallback to API links if HTML links are scarce
            if len(links) < 10:
                api_links = self._get_page_links_api(api_url, article_name)
                # Merge unique
                existing_urls = {l['url'] for l in links}
                for l in api_links:
                    if l['url'] not in existing_urls:
                        links.append(l)
            
            return {
                'success': True,
                'title': title,
                'content': self._clean_content(content),
                'links': links,
                'is_list_page': len(links) > 5,
                'url': url
            }
            
        except Exception as e:
            print(f"[Crawler] Moegirl API Error: {e}")
            return self._scrape_html(url)

    def _scrape_fandom(self, url: str, parsed) -> Dict:
        """Scrape Fandom wiki using MediaWiki API (parse action)"""
        from urllib.parse import unquote

        # Extract article title from URL
        # URL format: https://WIKI.fandom.com/wiki/ARTICLE or /zh/wiki/ARTICLE
        path_parts = parsed.path.strip('/').split('/')
        
        # Find article name (after 'wiki')
        article_name = None
        for i, part in enumerate(path_parts):
            if part == 'wiki' and i + 1 < len(path_parts):
                article_name = '/'.join(path_parts[i+1:])
                break
        
        if not article_name:
            return self._scrape_html(url)
            
        # Decode article name
        article_name = unquote(article_name)
        
        # Build API URL
        api_base = f"{parsed.scheme}://{parsed.netloc}"
        
        # Check if there's a language prefix (like /zh/)
        lang_prefix = ""
        if len(path_parts) > 0 and len(path_parts[0]) == 2 and path_parts[0] != 'wiki':
            lang_prefix = f"/{path_parts[0]}"
        
        api_url = f"{api_base}{lang_prefix}/api.php"
        
        # Use 'parse' action which actually returns content (unlike 'extracts' which is often empty)
        params = {
            'action': 'parse',
            'page': article_name,
            'prop': 'text|categories',
            'format': 'json',
            'redirects': '1'
        }
        
        try:
            response = self.session.get(api_url, params=params, timeout=15)
            response.raise_for_status()
            
            # Force UTF-8 encoding for MediaWiki JSON
            response.encoding = 'utf-8'
            
            try:
                data = response.json()
            except Exception as json_err:
                print(f"[Crawler] Fandom JSON parse error: {json_err}")
                return self._scrape_html(url)
            
            if 'error' in data:
                return self._scrape_html(url)
            
            parse_data = data.get('parse', {})
            title = parse_data.get('title', 'Untitled')
            html_content = parse_data.get('text', {}).get('*', '')
            categories = [c.get('*', '') for c in parse_data.get('categories', [])]
            
            content = ""
            links = []
            
            # Convert HTML to plain text using BeautifulSoup
            if html_content:
                soup = BeautifulSoup(html_content, 'lxml')
                
                # 1. Extract links (BEFORE cleaning text)
                links = self._extract_links(soup, url)
                
                content = self._extract_text_from_soup(soup)
            
            # Fallback to API links if HTML links are scarce
            if len(links) < 10:
                api_links = self._get_page_links_api(api_url, article_name)
                # Merge unique
                existing_urls = {l['url'] for l in links}
                for l in api_links:
                    if l['url'] not in existing_urls:
                        links.append(l)
            
            # Check if it's a list/category page
            is_list_page = any(x in title.lower() for x in ['角色', 'character', '列表', 'list', '目录', 'characters']) or len(links) > 10
            
            return {
                'success': True,
                'title': title,
                'content': self._clean_content(content),
                'links': links,
                'is_list_page': is_list_page,
                'url': url
            }
            
        except Exception as e:
            # Fallback to HTML scraping
            return self._scrape_html(url)
    
    def _scrape_wikipedia(self, url: str, parsed) -> Dict:
        """Scrape Wikipedia using REST API"""
        # URL format: https://XX.wikipedia.org/wiki/ARTICLE
        path_parts = parsed.path.strip('/').split('/')
        
        if len(path_parts) < 2 or path_parts[0] != 'wiki':
            return self._scrape_html(url)
        
        article_name = '/'.join(path_parts[1:])
        
        # Wikipedia REST API
        api_url = f"{parsed.scheme}://{parsed.netloc}/api/rest_v1/page/summary/{quote(article_name)}"
        
        try:
            response = self.session.get(api_url, timeout=15)
            response.raise_for_status()
            data = response.json()
            
            title = data.get('title', 'Untitled')
            extract = data.get('extract', '')
            
            # Get full article content
            content_url = f"{parsed.scheme}://{parsed.netloc}/api/rest_v1/page/mobile-html/{quote(article_name)}"
            content_resp = self.session.get(content_url, timeout=15)
            
            if content_resp.status_code == 200:
                soup = BeautifulSoup(content_resp.text, 'lxml')
                full_content = self._extract_text_from_soup(soup)
                if full_content:
                    extract = full_content
            
            return {
                'success': True,
                'title': title,
                'content': self._clean_content(extract),
                'links': [],
                'is_list_page': False,
                'url': url
            }
            
        except Exception:
            return self._scrape_html(url)
    
    def _scrape_mediawiki_api(self, url: str, parsed) -> Dict:
        """Generic MediaWiki API scraper"""
        path_parts = parsed.path.strip('/').split('/')
        
        article_name = None
        for i, part in enumerate(path_parts):
            if part == 'wiki' and i + 1 < len(path_parts):
                article_name = '/'.join(path_parts[i+1:])
                break
        
        if not article_name:
            return self._scrape_html(url)
        
        api_url = f"{parsed.scheme}://{parsed.netloc}/api.php"
        params = {
            'action': 'query',
            'titles': article_name,
            'prop': 'extracts',
            'explaintext': '1',
            'format': 'json',
        }
        
        try:
            response = self.session.get(api_url, params=params, timeout=15)
            data = response.json()
            
            pages = data.get('query', {}).get('pages', {})
            for page_id, page_data in pages.items():
                if page_id == '-1':
                    return self._scrape_html(url)
                
                return {
                    'success': True,
                    'title': page_data.get('title', 'Untitled'),
                    'content': self._clean_content(page_data.get('extract', '')),
                    'links': [],
                    'is_list_page': False,
                    'url': url
                }
            
            return self._scrape_html(url)
            
        except Exception:
            return self._scrape_html(url)
    
    def _get_page_links_api(self, api_url: str, page_title: str) -> List[Dict]:
        """Get links from a page using MediaWiki API"""
        params = {
            'action': 'query',
            'titles': page_title,
            'prop': 'links',
            'pllimit': '100',
            'format': 'json',
        }
        
        try:
            response = self.session.get(api_url, params=params, timeout=10)
            data = response.json()
            
            pages = data.get('query', {}).get('pages', {})
            links = []
            
            for page_id, page_data in pages.items():
                for link in page_data.get('links', []):
                    link_title = link.get('title', '')
                    if link_title and ':' not in link_title:  # Skip special pages
                        # Construct URL
                        base = api_url.replace('/api.php', '')
                        links.append({
                            'title': link_title,
                            'url': f"{base}/wiki/{quote(link_title)}"
                        })
            
            return links[:50]  # Limit to 50
            
        except Exception:
            return []
    
    def _scrape_html(self, url: str) -> Dict:
        """Fallback HTML scraping method"""
        try:
            response = self.session.get(url, timeout=15)
            response.raise_for_status()
            
            # Detect and set encoding BEFORE accessing response.text
            if response.encoding and response.encoding.lower() in ['iso-8859-1', 'ascii']:
                # Likely wrong detection, use apparent_encoding
                detected = response.apparent_encoding
                response.encoding = detected if detected else 'utf-8'
            elif not response.encoding:
                response.encoding = 'utf-8'
            
            # Force UTF-8 for Chinese domains
            parsed_check = urlparse(url)
            if any(x in parsed_check.netloc for x in ['moegirl', 'baike', 'hudong', 'zh.']):
                response.encoding = 'utf-8'
            
            soup = BeautifulSoup(response.text, 'lxml')
            
            title = self._extract_title(soup)
            links = self._extract_links(soup, url)
            content = self._extract_text_from_soup(soup)
            is_list_page = len(links) > 10
            
            return {
                'success': True,
                'title': title,
                'content': self._clean_content(content),
                'links': links if is_list_page else [],
                'is_list_page': is_list_page,
                'url': url
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f"无法加载页面: {str(e)}",
                'url': url
            }
    
    async def scrape_pages_concurrent(self, urls: List[str], concurrency: int = 10) -> List[Dict]:
        """
        Scrape multiple pages concurrently using thread pool executor.
        Uses the existing synchronous scrape_page method which works with MediaWiki API.
        Returns a list of structured data compatible with BatchExtractorAgent.
        """
        import concurrent.futures
        
        loop = asyncio.get_event_loop()
        
        # Use thread pool for concurrent I/O
        with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
            # Submit all scrape tasks
            futures = [
                loop.run_in_executor(executor, self._scrape_for_batch, url)
                for url in urls
            ]
            
            # Gather all results
            results = await asyncio.gather(*futures)
        
        return list(results)
    
    def _scrape_for_batch(self, url: str) -> Dict:
        """Wrapper around scrape_page that formats result for batch extraction"""
        try:
            result = self.scrape_page(url)
            
            # Convert to batch-compatible format
            return {
                'success': result.get('success', False),
                'url': url,
                'title': result.get('title', ''),
                'infobox': {},  # Not available from basic scrape
                'sections': {'content': result.get('content', '')[:2000]},  # Truncate for efficiency
                'summary': result.get('content', '')[:500] if result.get('content') else '',
                'error': result.get('error')
            }
        except Exception as e:
            return {
                'success': False,
                'url': url,
                'error': str(e)
            }

    async def _scrape_single_async(self, session: aiohttp.ClientSession, url: str, semaphore: asyncio.Semaphore) -> Dict:
        """Async scrape a single page and use WikiStructuredParser"""
        async with semaphore:
            try:
                # Basic headers
                headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
                
                # Handle encoding hint (force utf-8 for Chinese wikis)
                parsed = urlparse(url)
                force_utf8 = any(x in parsed.netloc for x in ['moegirl', 'baike', 'zh.'])
                
                timeout = aiohttp.ClientTimeout(total=30)
                async with session.get(url, headers=headers, timeout=timeout) as response:
                    if response.status != 200:
                        print(f"[Concurrent Scraper] HTTP {response.status} for {url}")
                        return {'success': False, 'url': url, 'error': f"Status {response.status}"}
                    
                    # Read bytes
                    content_bytes = await response.read()
                    
                    # flexible decoding
                    html = ""
                    if force_utf8:
                        html = content_bytes.decode('utf-8', errors='replace')
                    else:
                         # Try detected encoding or fallback
                        encoding = response.get_encoding() or 'utf-8'
                        try:
                            html = content_bytes.decode(encoding, errors='replace')
                        except:
                            html = content_bytes.decode('utf-8', errors='replace')
                    
                    # Parse with algorithm
                    # Extract Title from HTML title tag
                    title = ""
                    try:
                        soup_preview = BeautifulSoup(html[:5000], 'lxml') # fast preview
                        title_tag = soup_preview.find('title')
                        if title_tag:
                            title = title_tag.get_text(strip=True).split(' - ')[0]
                    except:
                        pass
                        
                    # Use the parser for structured data
                    parsed_data = wiki_parser.parse_page(html, title=title or url.split('/')[-1])
                    parsed_data['url'] = url
                    parsed_data['success'] = True
                    
                    # FALLBACK: If structured parsing yielded nothing, extract raw text
                    if not parsed_data.get('infobox') and not parsed_data.get('sections') and not parsed_data.get('summary'):
                        soup = BeautifulSoup(html, 'lxml')
                        # Get page content
                        content_div = soup.find('div', class_='mw-parser-output') or soup.find('body')
                        if content_div:
                            # Extract first few paragraphs as raw content
                            raw_paragraphs = []
                            for p in content_div.find_all('p')[:5]:
                                text = p.get_text(strip=True)
                                if len(text) > 20:
                                    raw_paragraphs.append(text)
                            
                            if raw_paragraphs:
                                parsed_data['summary'] = '\n'.join(raw_paragraphs[:2])
                                parsed_data['sections'] = {'background': '\n'.join(raw_paragraphs)}
                    
                    return parsed_data
                    
            except Exception as e:
                print(f"[Concurrent Scraper] Failed {url}: {e}")
                return {'success': False, 'url': url, 'error': str(e)}

    def _extract_title(self, soup: BeautifulSoup) -> str:
        """Extract page title"""
        title_tag = (
            soup.find('h1', class_='page-header__title') or
            soup.find('h1', class_='firstHeading') or
            soup.find('h1', id='firstHeading') or
            soup.find('h1') or
            soup.find('title')
        )
        return title_tag.get_text(strip=True) if title_tag else 'Untitled'
    
    def _extract_text_from_soup(self, soup: BeautifulSoup) -> str:
        """Extract main text content from soup with smart list/table handling"""
        # Content containers to try
        content_selectors = [
            ('div', {'class': 'mw-parser-output'}),
            ('div', {'id': 'mw-content-text'}),
            ('div', {'class': 'page-content'}),
            ('article', {}),
            ('main', {}),
        ]
        
        content = None
        for tag, attrs in content_selectors:
            content = soup.find(tag, attrs) if attrs else soup.find(tag)
            if content:
                break
        
        if not content:
            content = soup.find('body')
        
        if not content:
            return ""
        
        # Detect if this is likely a list/navigation page
        tables = content.find_all('table')
        lists = content.find_all(['ul', 'ol'])
        
        # If page has lots of tables/lists but little prose, preserve them
        is_list_heavy = len(tables) > 2 or len(lists) > 3
        
        # Remove unwanted elements
        for unwanted in content.find_all(['nav', 'aside', 'footer', 'script', 'style', 'noscript']):
            unwanted.decompose()
        
        # For list-heavy pages, be less aggressive about removal
        if not is_list_heavy:
            # Remove common navigation/meta classes only if NOT list page
            for cls in ['navbox', 'toc', 'sidebar', 'infobox', 'navigation', 'mw-editsection', 'reference']:
                for elem in content.find_all(class_=re.compile(cls, re.I)):
                    elem.decompose()
        
        # Extract text
        text_parts = []
        
        # Always try to get first paragraph as introduction
        first_p = content.find('p')
        if first_p:
            intro = first_p.get_text(strip=True)
            if intro and len(intro) > 20:
                text_parts.append(f"## 简介\n{intro}\n")
        
        # Extract from headings and paragraphs
        for elem in content.find_all(['h1', 'h2', 'h3', 'h4', 'p', 'li']):
            text = elem.get_text(strip=True)
            if not text or len(text) < 3:
                continue
            
            if elem.name in ['h1', 'h2']:
                text_parts.append(f"\n## {text}\n")
            elif elem.name in ['h3', 'h4']:
                text_parts.append(f"\n### {text}\n")
            else:
                text_parts.append(text)
        
        # If we still have very little content, try extracting from tables
        if len(text_parts) < 5 and tables:
            for table in tables[:3]:  # First 3 tables
                rows = table.find_all('tr')
                for row in rows[:10]:  # First 10 rows
                    cells = row.find_all(['td', 'th'])
                    row_text = ' | '.join([c.get_text(strip=True) for c in cells if c.get_text(strip=True)])
                    if row_text:
                        text_parts.append(row_text)
        
        result = '\n\n'.join(text_parts)
        
        # Absolute fallback: if still empty, grab ANY text
        if not result or len(result) < 50:
            result = content.get_text(separator='\n', strip=True)[:1000]
        
        return result
    
    def _extract_links(self, soup: BeautifulSoup, base_url: str) -> List[Dict]:
        """Extract internal links with enhanced table/category support"""
        base_domain = urlparse(base_url).netloc
        links = []
        seen_urls = set()
        
        content = soup.find('div', class_='mw-parser-output') or soup.find('body')
        if not content:
            return []
        
        # Priority 1: Extract from tables (character lists, etc.)
        tables = content.find_all('table')
        for table in tables[:20]:  # Check up to 20 tables
            for a_tag in table.find_all('a', href=True):
                href = a_tag['href']
                full_url = urljoin(base_url, href)
                
                if urlparse(full_url).netloc != base_domain:
                    continue
                
                # Relaxed filtering - allow category links
                if any(x in href.lower() for x in ['special:', 'file:', 'talk:', 'template:', 'user:']):
                    continue
                
                # Skip anchors but allow category
                if '#' in href and 'category' not in href.lower():
                    continue
                
                link_text = a_tag.get_text(strip=True)
                if not link_text or len(link_text) < 2:
                    continue
                
                if full_url not in seen_urls:
                    seen_urls.add(full_url)
                    links.append({'title': link_text, 'url': full_url})
                
                if len(links) >= 300:  # Increased limit
                    break
            
            if len(links) >= 300:
                break
        
        # Priority 2: Extract from lists
        if len(links) < 300:
            lists = content.find_all(['ul', 'ol'])
            for lst in lists[:20]:
                for a_tag in lst.find_all('a', href=True):
                    if len(links) >= 300:
                        break
                        
                    href = a_tag['href']
                    full_url = urljoin(base_url, href)
                    
                    if urlparse(full_url).netloc != base_domain:
                        continue
                    
                    if any(x in href.lower() for x in ['special:', 'file:', 'talk:', 'template:', 'user:']):
                        continue
                    
                    if '#' in href and 'category' not in href.lower():
                        continue
                    
                    link_text = a_tag.get_text(strip=True)
                    if not link_text or len(link_text) < 2:
                        continue
                    
                    if full_url not in seen_urls:
                        seen_urls.add(full_url)
                        links.append({'title': link_text, 'url': full_url})
        
        # Priority 3: General content links (if still need more)
        if len(links) < 300:
            for a_tag in content.find_all('a', href=True):
                if len(links) >= 300:
                    break
                    
                href = a_tag['href']
                full_url = urljoin(base_url, href)
                
                if urlparse(full_url).netloc != base_domain:
                    continue
                
                if any(x in href.lower() for x in ['special:', 'file:', 'talk:', 'template:', 'user:']):
                    continue
                
                if '#' in href and 'category' not in href.lower():
                    continue
                
                link_text = a_tag.get_text(strip=True)
                if not link_text or len(link_text) < 2:
                    continue
                
                if full_url not in seen_urls:
                    seen_urls.add(full_url)
                    links.append({'title': link_text, 'url': full_url})
        
        return links
    
    def _clean_content(self, content: str) -> str:
        """Clean and normalize content"""
        if not content:
            return ""
        
        # Remove excessive whitespace
        content = re.sub(r'\n{3,}', '\n\n', content)
        content = re.sub(r' {2,}', ' ', content)
        content = content.strip()
        
        # Truncate if too long
        if len(content) > 20000:
            content = content[:20000] + "\n\n[内容已截断...]"
        
        return content


# Singleton instance
crawler_service = CrawlerService()

