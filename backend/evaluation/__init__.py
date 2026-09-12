# -*- coding: utf-8 -*-
"""P6 evaluation utilities."""

from evaluation.golden_replay import run_golden_replay_suite
from evaluation.longform_benchmark import LongformBenchmarkHarness, ensure_benchmark_gitignore
from evaluation.retrieval_eval import evaluate_retrieval_recall
from evaluation.trace_replay import replay_trace_file, replay_trace_payload, summarize_trace
from evaluation.p12_context_eval import (
    P12_CONTEXT_COMPARISONS,
    P12_CONTEXT_VARIANTS,
    analyze_p12_pairwise,
    assemble_p12_context,
)
from evaluation.campaign_models import EvalCampaign
from evaluation.campaign_runner import CampaignRunner

__all__ = [
    "evaluate_retrieval_recall",
    "ensure_benchmark_gitignore",
    "LongformBenchmarkHarness",
    "replay_trace_file",
    "replay_trace_payload",
    "run_golden_replay_suite",
    "summarize_trace",
    "P12_CONTEXT_COMPARISONS",
    "P12_CONTEXT_VARIANTS",
    "analyze_p12_pairwise",
    "assemble_p12_context",
    "EvalCampaign",
    "CampaignRunner",
]
