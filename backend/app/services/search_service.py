"""
Search Service for Fanfiction Feature
Uses DuckDuckGo to find Wiki pages for given franchises
"""

from typing import List, Dict

# Try new package name first, fallback to old
try:
    from ddgs import DDGS
except ImportError:
    from duckduckgo_search import DDGS


class SearchService:
    """Service for searching Wiki pages using DuckDuckGo"""
    
    def __init__(self):
        self.ddgs = DDGS()
        # Prioritize these domains for wiki results
        self.wiki_domains = [
            'fandom.com',
            'huijiwiki.com',
            'moegirl.org.cn',
            'moegirl.org',
            'wiki.gg',
            'wikia.org',
            'wikipedia.org'
        ]
    
    def search_wiki(self, query: str, max_results: int = 20, engine: str = 'all') -> List[Dict[str, str]]:
        """
        Search for Wiki pages related to the query
        
        Args:
            query: Search query
            max_results: Maximum number of results to return
            engine: Search engine to use ('all', 'wiki', 'moegirl')
            
        Returns:
            List of search results with title, url, snippet, and source
        """
        results = []
        seen_urls = set()
        import requests
        
        # 1. Moegirl Specific Search (OpenSearch API)
        if engine in ['all', 'moegirl']:
            try:
                # Use OpenSearch for better relevance (finding main pages)
                # DDG site: search often returns subpages
                api_url = "https://zh.moegirl.org.cn/api.php"
                params = {
                    "action": "opensearch",
                    "search": query,
                    "limit": 10 if engine == 'moegirl' else 5,
                    "format": "json"
                }
                headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
                
                resp = requests.get(api_url, params=params, headers=headers, timeout=5)
                data = resp.json()
                
                # OpenSearch format: [query, [titles], [descriptions], [urls]]
                if len(data) >= 4:
                    titles = data[1]
                    descriptions = data[2] # Often empty on Moegirl, but let's try
                    urls = data[3]
                    
                    for i in range(len(titles)):
                        url = urls[i]
                        if url and url not in seen_urls:
                            # Filter out blatant subpages if generic search, keep if specific
                            # But OpenSearch usually ranks main page first.
                            
                            results.append({
                                'title': titles[i],
                                'url': url,
                                'snippet': descriptions[i] if descriptions[i] else f"萌娘百科条目: {titles[i]}",
                                'source': '萌娘百科'
                            })
                            seen_urls.add(url)
                            
            except Exception as e:
                print(f"[SearchService] Moegirl API error: {e}")

        # 2. Generic Wiki Search (DuckDuckGo)
        if engine in ['all', 'wiki']:
            search_query = f"{query} wiki"
            try:
                limit = max_results if engine == 'wiki' else (max_results - len(results))
                if limit <= 0:
                    limit = 5 # Always fetch a few
                    
                generic_raw = self.ddgs.text(search_query, max_results=limit)
                for res in generic_raw:
                    url = res.get('href', '')
                    if not url or url in seen_urls:
                        continue
                    
                    # Filter for wiki domains
                    is_wiki = any(domain in url.lower() for domain in self.wiki_domains)
                    
                    if is_wiki:
                        source = self._extract_domain(url)
                        # Normalize source names
                        if 'moegirl' in source:
                            source = '萌娘百科'
                        elif 'fandom' in source:
                            source = 'Fandom'
                        elif 'wikipedia' in source:
                            source = 'Wikipedia'
                            
                        results.append({
                            'title': res.get('title', ''),
                            'url': url,
                            'snippet': res.get('body', ''),
                            'source': source
                        })
                        seen_urls.add(url)
                    
                    if len(results) >= max_results:
                        break
            except Exception as e:
                print(f"[SearchService] Generic search error: {e}")
            
        return results
    
    def _extract_domain(self, url: str) -> str:
        """Extract readable domain from URL"""
        try:
            from urllib.parse import urlparse
            parsed = urlparse(url)
            domain = parsed.netloc
            # Remove www. prefix
            if domain.startswith('www.'):
                domain = domain[4:]
            return domain
        except:
            return url


# Singleton instance
search_service = SearchService()
