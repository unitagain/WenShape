"""
Extractor Agent
Converts Wiki text into structured Card Proposals
"""

from typing import Dict, Any, List
from app.agents.base import BaseAgent
from app.schemas.draft import CardProposal
import json


class ExtractorAgent(BaseAgent):
    """
    Extractor agent for converting Wiki content to Card Proposals
    """
    
    def get_agent_name(self) -> str:
        return "extractor"
    
    async def execute(
        self,
        project_id: str,
        chapter: str,
        context: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Execute extractor task - wrapper for extract_cards"""
        title = context.get("title", "Unknown")
        content = context.get("content", "")
        max_cards = context.get("max_cards", 20)
        
        proposals = await self.extract_cards(title, content, max_cards)
        return {"proposals": proposals}
    
    def get_system_prompt(self) -> str:
        return """You are an Extractor agent for novel writing.

Your responsibility:
Extract key characters, locations, and concepts from Wiki pages and convert them into structured setting cards.

Core principles:
- Focus on information useful for creative writing (personality, appearance, relationships).
- Ignore detailed plot summaries, episode lists, or trivia.
- For characters: extract name, identity/role, personality traits, key relationships.
- For locations: extract name, category (city/building/realm), description, atmosphere.
- Keep descriptions concise (1-3 sentences).

Output Format:
- Generate JSON array of Card Proposals.
- Each proposal must have: name, type (Character/World), description, rationale.

你是设定提取智能体。

职责：
从 Wiki 页面中提取角色、地点、概念，转化为结构化设定卡。

核心原则：
- 聚焦对小说创作有用的信息（性格、外貌、关系）。
- 忽略详细剧情摘要、集数列表、琐碎趣闻。
- 角色卡：提取姓名、身份、性格特征、关键关系。
- 世界卡：提取名称、类别（城市/建筑/领域）、描述、氛围。
- 描述简洁（1-3句）。

输出格式：
- 生成 JSON 数组的卡片提案。
- 每个提案必须有：name, type, description, rationale。"""
    
    async def extract_cards(
        self,
        title: str,
        content: str,
        max_cards: int = 20
    ) -> List[CardProposal]:
        """
        Extract card proposals from Wiki content
        """
        # Build user prompt
        user_prompt = f"""Extract detailed setting cards from the following Wiki page.

Page Title: {title}

Content:
{content[:15000]}...

Requirements:
- Extract the MOST IMPORTANT entities (characters, locations).
- Maximum {max_cards} cards.
- **CRITICAL: Provide DETAILED content for all fields. Do not summarize too much.**
- For characters, extract: personality, appearance, background, abilities, relationships.
- **APPEARANCE**: Describe physical features (hair, eyes, height, build, clothing style, distinctive marks).

Output strict JSON array format:
[
  {{
    "name": "Exact Name",
    "type": "Character" | "World",
    "description": "Short identity (e.g. 'A Rover wakening from slumber')",
    "rationale": "Why this is important",
    "personality": ["Trait 1", "Trait 2"],
    "appearance": "Detailed physical description (hair color, eye color, height, build, clothing, etc.)",
    "background": "Detailed background story (2-3 paragraphs)",
    "abilities": "Detailed description of combat style and skills",
    "relationships": [
        {{"target": "Related Name", "relation": "friend/enemy/..."}}
    ],
    "confidence": 0.9
  }}
]

Output JSON ONLY. No markdown, no commentary.

要求：
- 提取详细的设定信息。
- 必须包含性格、外貌、背景、能力、关系。
- 外貌描述应包括发色、瞳色、身高、体型、服装风格等。
- 仅输出 JSON 数组。"""
        
        # Call LLM
        messages = self.build_messages(
            system_prompt=self.get_system_prompt(),
            user_prompt=user_prompt
        )
        
        response = await self.call_llm(messages)
        
        # Parse JSON
        proposals = []
        try:
            # Extract JSON from response
            clean_resp = response
            if "```json" in response:
                clean_resp = response.split("```json")[1].split("```")[0]
            elif "```" in response:
                clean_resp = response.split("```")[1].split("```")[0]
            
            data = json.loads(clean_resp)
            
            for item in data:
                # Validate
                if not isinstance(item, dict):
                    continue
                if not item.get("name") or not item.get("type"):
                    continue
                
                # Confidence filter
                confidence = item.get("confidence", 0.8)
                if confidence < 0.6:
                    continue
                
                proposals.append(CardProposal(**item))
                
        except Exception as e:
            print(f"[ExtractorAgent] Failed to parse proposals: {e}")
            print(f"Raw response: {response[:200]}...")
        
        return proposals
