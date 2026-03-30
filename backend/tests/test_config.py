"""Tests for lazy runtime configuration behavior."""

from __future__ import annotations

from pathlib import Path

import pytest

import app.config as app_config


@pytest.fixture(autouse=True)
def clear_runtime_config_cache(monkeypatch):
    app_config.reload_runtime_config()
    yield
    app_config.reload_runtime_config()


def test_debug_flag_accepts_legacy_release_value(monkeypatch):
    monkeypatch.setenv("DEBUG", "release")
    settings = app_config.get_settings()
    assert settings.debug is False


def test_settings_proxy_is_lazy_and_writable(monkeypatch):
    monkeypatch.setenv("DEBUG", "true")
    assert app_config.settings.debug is True

    app_config.settings.port = 9001
    assert app_config.get_settings().port == 9001


def test_config_falls_back_when_yaml_missing():
    cfg = app_config._fallback_config()
    assert "llm" in cfg
    assert "session" in cfg
    assert "context_budget" in cfg


def test_load_config_reads_yaml(tmp_path: Path):
    config_file = tmp_path / "config.yaml"
    config_file.write_text("session:\n  max_iterations: 7\n", encoding="utf-8")

    loaded = app_config.load_config(str(config_file))
    assert loaded["session"]["max_iterations"] == 7
