"""
Fanfiction Router
API endpoints for the fanfiction feature
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from app.services.search_service import search_service
from app.services.crawler_service import crawler_service
from app.agents.extractor import ExtractorAgent
from app.agents.batch_extractor import BatchExtractorAgent
from app.llm_gateway.gateway import get_gateway
from app.storage import CardStorage
from app.storage.cards import cards_storage
from app.utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/fanfiction", tags=["fanfiction"])

# Use imported storage instance
card_storage = cards_storage


# Schema definitions
class SearchRequest(BaseModel):
    query: str
    engine: str = "all"


class SearchResult(BaseModel):
    title: str
    url: str
    snippet: str
    source: str


class PreviewRequest(BaseModel):
    url: str


class PreviewResponse(BaseModel):
    success: bool
    title: Optional[str] = None
    content: Optional[str] = None
    links: List[Dict[str, str]] = []
    is_list_page: bool = False
    error: Optional[str] = None


class ExtractRequest(BaseModel):
    project_id: str
    title: str
    content: str
    max_cards: int = 20


class BatchExtractRequest(BaseModel):
    project_id: str
    urls: List[str]


class ExtractResponse(BaseModel):
    success: bool
    proposals: List[Dict] = []
    error: Optional[str] = None


@router.post("/search", response_model=List[SearchResult])
async def search_wikis(request: SearchRequest):
    """Search for relevant Wiki pages"""
    try:
        results = search_service.search_wiki(request.query, engine=request.engine, max_results=10)
        return [SearchResult(**r) for r in results]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/preview", response_model=PreviewResponse)
async def preview_page(request: PreviewRequest):
    """
    Scrape a Wiki page and return preview
    
    Args:
        url: URL of the wiki page
        
    Returns:
        Page content and metadata
    """
    try:
        result = crawler_service.scrape_page(request.url)
        
        if not result['success']:
            return PreviewResponse(
                success=False,
                error=result.get('error', 'Unknown error')
            )
        
        return PreviewResponse(
            success=True,
            title=result['title'],
            content=result['content'],
            links=result['links'],
            is_list_page=result['is_list_page']
        )
    except Exception as e:
        return PreviewResponse(
            success=False,
            error=str(e)
        )


@router.post("/extract", response_model=ExtractResponse)
async def extract_cards(request: ExtractRequest):
    """Deep detailed extraction for a single page (legacy/single mode)"""
    try:
        agent = ExtractorAgent(
            agent_id="wiki_extractor",
            config={}
        )
        
        proposals = await agent.extract_cards(
            title=request.title,
            content=request.content[:15000],  # Increase limit to 15k
            max_cards=request.max_cards
        )
        
        return {
            "success": True,
            "proposals": [p.dict() for p in proposals]
        }
    except Exception as e:
        logger.error(f"Extraction failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e),
            "proposals": []
        }

@router.post("/extract/batch", response_model=ExtractResponse)
async def batch_extract_cards(request: BatchExtractRequest):
    """High-speed batch extraction for multiple pages"""
    try:
        # 1. Concurrent Crawl (Limit to 50 for safety)
        urls = request.urls[:50]
        results = await crawler_service.scrape_pages_concurrent(urls)
        
        # 2. Batch Agent Processing
        agent = BatchExtractorAgent(
            agent_id="batch_extractor",
            config={}
        )
        
        # Pass structured data to agent
        proposals = await agent.execute(
            project_id=request.project_id,
            chapter="batch",
            context={"pages_data": results}
        )
        
        return {
            "success": True,
            "proposals": [p.dict() for p in proposals]
        }
        
    except Exception as e:
        logger.error(f"Batch extraction failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e),
            "proposals": []
        }
