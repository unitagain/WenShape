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
- Extract the MOST IMPORTANT entities (characters, locations, concepts, organizations).
- Maximum {max_cards} cards.
- **CRITICAL: You MUST create BOTH Character AND World cards. Aim for a balanced mix.**

**TYPE CLASSIFICATION (Very Important!):**
- **Character**: Any person, creature, or sentient being with a name. Examples: heroes, villains, NPCs, named monsters.
- **World**: Any non-person entity. Examples:
  - Locations: cities, countries, buildings, dungeons, realms
  - Organizations: guilds, factions, companies, governments
  - Concepts: magic systems, technologies, historical events, artifacts, items
  - Species/Races: non-sentient creatures, monster types (when describing the species, not an individual)

**For EACH Character card, extract:**
- personality: personality traits as array
- appearance: physical description (hair, eyes, height, build, clothing)
- background: backstory (2-3 paragraphs)
- abilities: combat style, powers, skills
- relationships: connections to other characters

**For EACH World card, extract:**
- description: what it is and its significance
- category: "Location" | "Organization" | "Concept" | "Item" | "Species"
- rules: any special rules or properties (for magic systems, artifacts, etc.)

Output strict JSON array format with MIXED types:
[
  {{
    "name": "Character Name",
    "type": "Character",
    "description": "Short identity",
    "rationale": "Why important for writing",
    "personality": ["Trait 1", "Trait 2"],
    "appearance": "Physical description",
    "background": "Backstory",
    "abilities": "Powers and skills",
    "relationships": [{{"target": "Name", "relation": "friend/enemy/..."}}],
    "confidence": 0.9
  }},
  {{
    "name": "Location or Concept Name",
    "type": "World",
    "description": "What it is and its atmosphere/purpose",
    "category": "Location",
    "rationale": "Why important for worldbuilding",
    "rules": ["Special rule 1", "Special rule 2"],
    "confidence": 0.85
  }}
]

Output JSON ONLY. No markdown, no commentary.
**You MUST include at least 1 World card if any locations/organizations/concepts are mentioned.**

要求：
- 提取详细的设定信息。
- **必须同时提取角色卡和世界观卡，保持平衡。**
- 角色卡包括：性格、外貌、背景、能力、关系。
- 世界卡包括：地点、组织、概念、物品、魔法体系等。
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
