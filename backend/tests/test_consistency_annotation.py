# -*- coding: utf-8 -*-
"""
评估修复回归（P4 change set 一致性标注）。

标注是提示性（advisory）的确定性信号：相关既有事实（eligible + as-of 过滤）与
称呼核对；不修改 original/revised、不阻断 apply_change_set、异常一律降级。
"""

import asyncio

from app.schemas.canon import Fact
from app.services.consistency_annotation_service import ConsistencyAnnotationService


class _Storage:
    def __init__(self, facts=None, edges=None):
        self._facts = facts or []
        self._edges = edges or []

    async def get_eligible_facts(self, project_id):
        return list(self._facts)

    async def get_card_relation_edges(self, project_id):
        return list(self._edges)


def _fact(statement, fact_id="F1", introduced_in="V1C001", status="confirmed"):
    return Fact(id=fact_id, statement=statement, source=introduced_in, introduced_in=introduced_in, status=status)


def _annotate(service, change_set):
    asyncio.run(service.annotate_change_set("p", change_set))
    return change_set


def test_related_fact_annotated_when_tokens_hit():
    service = ConsistencyAnnotationService(_Storage(facts=[_fact("张三在迷雾森林取得青铜钥匙")]))
    change_set = [
        {
            "asset_type": "chapter",
            "asset_id": "V1C005",
            "original": "旧",
            "revised": "张三握着青铜钥匙，回望迷雾森林的深处。",
        }
    ]
    _annotate(service, change_set)
    annotations = change_set[0]["consistency_annotations"]
    assert annotations and annotations[0]["kind"] == "related_fact"
    assert "青铜钥匙" in annotations[0]["note"]
    # 非阻断：original/revised 不被修改。
    assert change_set[0]["revised"].startswith("张三握着")


def test_no_annotation_when_no_token_overlap():
    service = ConsistencyAnnotationService(_Storage(facts=[_fact("张三在迷雾森林取得青铜钥匙")]))
    change_set = [
        {"asset_type": "chapter", "asset_id": "V1C005", "original": "", "revised": "沈桥在集市买了一条红丝巾。"}
    ]
    _annotate(service, change_set)
    assert "consistency_annotations" not in change_set[0]


def test_future_facts_are_excluded_by_as_of_semantics():
    """写作时点之后才确立的事实不在核对范围（与检索侧 TemporalScopeFilter 同口径）。"""
    service = ConsistencyAnnotationService(_Storage(facts=[_fact("青铜钥匙后来被访客带走", introduced_in="V1C009")]))
    change_set = [
        {"asset_type": "chapter", "asset_id": "V1C005", "original": "", "revised": "青铜钥匙静静躺在桌上。"}
    ]
    _annotate(service, change_set)
    assert "consistency_annotations" not in change_set[0]


def test_same_chapter_fact_is_skipped_to_avoid_self_reference():
    """introduced_in 等于本章的事实是本轮抽取对象——标注它只会制造噪声。"""
    service = ConsistencyAnnotationService(_Storage(facts=[_fact("本章张三取得青铜钥匙", introduced_in="V1C005")]))
    change_set = [
        {"asset_type": "chapter", "asset_id": "V1C005", "original": "", "revised": "张三取得青铜钥匙。"}
    ]
    _annotate(service, change_set)
    assert "consistency_annotations" not in change_set[0]


def test_appellation_annotation_when_dialogue_pair_lacks_set_form():
    service = ConsistencyAnnotationService(
        _Storage(
            edges=[
                {
                    "from": "林舟",
                    "relation": "姐姐",
                    "to": "沈桥",
                    "appellation": "阿舟",
                    "reverse_appellation": "小桥",
                }
            ]
        )
    )
    change_set = [
        {"asset_type": "chapter", "asset_id": "V1C005", "original": "", "revised": "林舟对沈桥说：「你别管我的事。」她转过身去。"}
    ]
    _annotate(service, change_set)
    annotations = change_set[0]["consistency_annotations"]
    assert any(a["kind"] == "appellation" for a in annotations)


def test_appellation_annotation_suppressed_when_set_form_present():
    service = ConsistencyAnnotationService(
        _Storage(
            edges=[
                {
                    "from": "林舟",
                    "relation": "姐姐",
                    "to": "沈桥",
                    "appellation": "阿舟",
                    "reverse_appellation": "小桥",
                }
            ]
        )
    )
    change_set = [
        {"asset_type": "chapter", "asset_id": "V1C005", "original": "", "revised": "林舟对沈桥说：「小桥，你别管我的事。」"}
    ]
    _annotate(service, change_set)
    assert "consistency_annotations" not in change_set[0]


def test_annotations_capped_with_explicit_overflow_notice():
    """每资产 ≤3 条，超限以汇总条目显式表达（不静默截断）。"""
    facts = [
        _fact("张三取得青铜钥匙", fact_id=f"F{i}", introduced_in="V1C001") for i in range(5)
    ]
    service = ConsistencyAnnotationService(_Storage(facts=facts))
    change_set = [
        {"asset_type": "chapter", "asset_id": "V1C005", "original": "", "revised": "张三取得青铜钥匙后又放下青铜钥匙。"}
    ]
    _annotate(service, change_set)
    annotations = change_set[0]["consistency_annotations"]
    assert len(annotations) == 4  # 3 条事实 + 1 条超限汇总
    assert annotations[-1]["kind"] == "more"


def test_outline_assets_are_not_annotated():
    service = ConsistencyAnnotationService(_Storage(facts=[_fact("张三取得青铜钥匙")]))
    change_set = [
        {"asset_type": "outline", "asset_id": "outline", "original": "", "revised": "大纲改动：张三取得青铜钥匙的规划。"}
    ]
    _annotate(service, change_set)
    assert "consistency_annotations" not in change_set[0]


def test_storage_failure_degrades_without_raising():
    class _Broken:
        async def get_eligible_facts(self, project_id):
            raise RuntimeError("boom")

        async def get_card_relation_edges(self, project_id):
            raise RuntimeError("boom")

    service = ConsistencyAnnotationService(_Broken())
    change_set = [{"asset_type": "chapter", "asset_id": "V1C005", "original": "", "revised": "正文。"}]
    _annotate(service, change_set)  # 不得抛出
    assert "consistency_annotations" not in change_set[0]


def test_apply_change_set_ignores_annotation_field(tmp_path):
    """带 annotations 的 proposal 照常通过 preflight 与写入（字段透传、不参与校验）。"""
    from app.orchestrator.orchestrator import Orchestrator

    orchestrator = Orchestrator(str(tmp_path))
    asyncio.run(orchestrator.draft_storage.save_current_draft("p", "V1C001", "旧正文", 3))
    revision = int(orchestrator.draft_storage.get_draft_revision("p", "V1C001")["revision"])
    proposal = {
        "asset_type": "chapter",
        "asset_id": "V1C001",
        "original": "旧正文",
        "revised": "新正文",
        "base_revision": revision,
        "consistency_annotations": [{"kind": "related_fact", "source": "canon:F1", "statement": "x", "note": "请核对"}],
    }
    result = asyncio.run(orchestrator.apply_change_set("p", [proposal]))
    assert result["success"] is True
    text, _ = asyncio.run(orchestrator.draft_storage.get_working_text("p", "V1C001"))
    assert text == "新正文"
