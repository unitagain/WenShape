from typing import Dict, List, Any
import json
import re
from app.agents.base import BaseAgent
from app.schemas.draft import CardProposal
from app.context_engine.compressor import context_compressor
from app.llm_gateway.gateway import get_gateway
from app.utils.logger import get_logger

logger = get_logger(__name__)


class BatchExtractorAgent:
    """
    Agent for high-speed batch character extraction.
    Receives aggregated structured data and makes a single LLM call.
    """
    
    def __init__(self, agent_id: str, config: Dict[str, Any]):
        self.agent_id = agent_id
        self.config = config

    async def execute(self, project_id: str, chapter: str, context: Dict[str, Any]) -> List[CardProposal]:
        """
        Execute batch extraction
        Context must contain 'pages_data': List[Dict] (output of WikiStructuredParser)
        """
        pages_data = context.get('pages_data', [])
        if not pages_data:
            return []
            
        # Limit to 50 pages per batch to avoid context overflow
        if len(pages_data) > 60:
            pages_data = pages_data[:60]
            
        # Construct efficient payload (minimize tokens)
        compressed_data = []
        for p in pages_data:
            if not p.get('success'):
                continue
                
            compressed_data.append({
                'source': p.get('title'),
                'info': p.get('infobox', {}),
                'desc': p.get('sections', {}),
                'intro': p.get('summary', '')[:300]
            })
        
        logger.debug(f"Compressed data entries: {len(compressed_data)}")
        
        if not compressed_data:
            logger.debug("No compressed data - returning empty")
            return []
            
        json_payload = json.dumps(compressed_data, ensure_ascii=False)
        logger.debug(f"Payload size: {len(json_payload)} chars")
        
        system_prompt = self.get_system_prompt()
        user_prompt = f"batch_data:\n{json_payload}"
        
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
        
        try:
            gateway = get_gateway()
            logger.debug(f"Calling LLM with provider={self.config.get('provider')}")
            
            # Note: gateway.chat() returns a dict with 'content' field
            # Don't specify provider - let gateway use configured default
            result = await gateway.chat(
                messages=messages,
                provider=self.config.get('provider'),
                temperature=0.3,
                max_tokens=4000
            )
            
            # Extract content from response dict
            response = result.get('content', '') if isinstance(result, dict) else str(result)
            
            logger.debug(f"LLM response length: {len(response) if response else 0}")
            logger.debug(f"LLM response preview: {response[:200] if response else 'NONE'}")
            
            # Clean response and parse JSON
            clean_resp = self._clean_json_response(response)
            logger.debug(f"Cleaned JSON length: {len(clean_resp)}")
            
            data = json.loads(clean_resp)
            logger.debug(f"Parsed {len(data)} items from JSON")
            
            proposals = []
            for item in data:
                if not isinstance(item, dict): 
                    continue
                if not item.get('name'): 
                    continue
                
                if not item.get('type'): 
                    item['type'] = 'Character'
                
                proposals.append(CardProposal(**item))
            
            logger.info(f"Created {len(proposals)} proposals")
            return proposals
            
        except Exception as e:
            logger.error(f"Batch extraction failed: {e}", exc_info=True)
            return []

    def _clean_json_response(self, response: str) -> str:
        """Clean LLM response to extract JSON"""
        if not response:
            return "[]"
        
        response = response.strip()
        
        # Remove markdown code blocks
        if response.startswith("```"):
            lines = response.split("\n")
            lines = [l for l in lines if not l.startswith("```")]
            response = "\n".join(lines)
        
        # Find array bounds
        start = response.find("[")
        end = response.rfind("]") + 1
        
        if start >= 0 and end > start:
            return response[start:end]
        
        return "[]"

    def get_system_prompt(self) -> str:
        return """You are an expert Data Extractor.
Task: Convert raw wiki data into standardized Character Cards.

Input is a JSON list of characters. Each entry contains:
- info: Structured infobox data
- desc: Key paragraphs (appearance, personality, etc)
- intro: First paragraph
- source: Wiki page title

Output Requirements:
1. Return a JSON Array of objects.
2. Each object must follow the schema below.
3. Use 'info' fields directly where possible (high confidence).
4. Synthesize 'desc' and 'intro' for Personality, Appearance, Background.
5. If a field is missing, use empty string or list.

Schema:
[
  {
    "name": "Exact Name",
    "type": "Character",
    "description": "Short identity",
    "rationale": "Extracted from [Source Title]",
    "personality": ["Trait 1", "Trait 2"],
    "appearance": "Physical description",
    "background": "Background story",
    "abilities": "Skills",
    "relationships": [{"target": "Name", "relation": "Type"}],
    "confidence": 0.95
  }
]

CRITICAL:
- Output JSON ONLY.
- Keep useful details.
- Extract 'Appearance' from 'desc.appearance' or 'info' fields.
"""
