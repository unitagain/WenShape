import json
from typing import Any, Dict, List, Optional

from app.llm_gateway.providers.base import BaseLLMProvider


class MockProvider(BaseLLMProvider):
    def __init__(self):
        super().__init__(api_key="", model="mock", max_tokens=2000, temperature=0.0)

    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
    ) -> Dict[str, Any]:
        content = self._build_mock_content(messages=messages)

        return {
            "content": content,
            "usage": {
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
            },
            "model": self.model,
            "finish_reason": "stop",
        }

    async def stream_chat(
        self,
        messages: List[Dict[str, str]],
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
    ):
        content = self._build_mock_content(messages=messages)
        chunk_size = 80
        for i in range(0, len(content), chunk_size):
            yield content[i : i + chunk_size]

    def _has_all(self, text: str, keywords: List[str]) -> bool:
        return all(k in text for k in keywords)

    def _build_mock_content(self, messages: List[Dict[str, str]]) -> str:
        message_text = "\n".join([str(m.get("content") or "") for m in (messages or [])])
        lower_text = message_text.lower()

        # JSON list: writer pre-writing questions
        if self._has_all(message_text, ["json", "type", "plot_point", "text"]):
            return json.dumps(
                [
                    {"type": "plot_point", "text": "本章必须完成的关键事件是什么？请给出一个可落地场景。"},
                    {"type": "character_change", "text": "主角此章情绪或动机要发生什么变化？"},
                    {"type": "detail_gap", "text": "地点、时间或关键道具还有哪些细节需要先确认？"},
                ],
                ensure_ascii=False,
            )

        # YAML: chapter summary
        if self._has_all(lower_text, ["yaml", "new_facts", "brief_summary", "key_events"]):
            return (
                "chapter: V1C1\n"
                "title: Mock章节\n"
                "word_count: 1200\n"
                "key_events:\n"
                "  - 主角在旧城区获得关键线索\n"
                "  - 主角与同伴发生立场分歧\n"
                "new_facts:\n"
                "  - 旧城区地下网络由灰潮会控制\n"
                "  - 主角掌握了进入档案库的临时口令\n"
                "character_state_changes:\n"
                "  - 主角对同伴的信任下降\n"
                "open_loops:\n"
                "  - 口令有效期尚未确认\n"
                "brief_summary: 主角在追查中取得突破，但团队关系出现裂痕。\n"
            )

        # YAML: canon updates
        if self._has_all(lower_text, ["yaml", "facts:", "timeline_events", "character_states"]):
            return (
                "facts:\n"
                "  - statement: 旧城区地下网络由灰潮会控制\n"
                "    confidence: 0.9\n"
                "  - statement: 主角获得进入档案库的临时口令\n"
                "    confidence: 0.85\n"
                "timeline_events:\n"
                "  - time: 当夜\n"
                "    event: 主角潜入旧城区取得情报\n"
                "    participants: [主角, 同伴]\n"
                "    location: 旧城区\n"
                "character_states:\n"
                "  - character: 主角\n"
                "    goals: [进入档案库]\n"
                "    injuries: []\n"
                "    inventory: [临时口令]\n"
                "    relationships: {同伴: 信任下降}\n"
                "    location: 旧城区\n"
                "    emotional_state: 警惕\n"
            )

        # YAML: volume summary
        if self._has_all(lower_text, ["yaml", "volume_id", "chapter_count", "major_events"]):
            return (
                "volume_id: V1\n"
                "brief_summary: 主线围绕调查旧城区势力展开，冲突持续升级。\n"
                "key_themes:\n"
                "  - 信任与背叛\n"
                "major_events:\n"
                "  - 主角获取关键情报\n"
                "chapter_count: 3\n"
            )

        # JSON object: fanfiction card extraction
        if self._has_all(lower_text, ["json", "name", "type", "description"]) and (
            "character" in lower_text or "world" in lower_text
        ):
            return json.dumps(
                {
                    "name": "Mock角色",
                    "type": "Character",
                    "description": "该角色身份明确，行动目标稳定。外在特征鲜明，言行克制。与主角存在持续博弈关系，是推动主线冲突的关键人物。",
                },
                ensure_ascii=False,
            )

        # Draft fallback
        return (
            "Mock内容生成：根据输入的提示词，返回了这段文本。你可以根据需要修改 MockProvider 的 _build_mock_content 方法来定制不同的返回内容，以便测试不同的场景和功能。"
        )

    def get_provider_name(self) -> str:
        return "mock"
