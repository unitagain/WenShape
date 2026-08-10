"""W1 local authentication, credential storage and redaction regressions."""

from __future__ import annotations

import json
import logging
from pathlib import Path

import pytest
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.security.local_auth import LocalAuthMiddleware, LocalAuthPolicy, warn_if_exposed_without_auth
from app.services.llm_config_service import LLMConfigService
from app.utils.logger import RedactingFormatter


class MemoryVault:
    def __init__(self, *, fail_on_set: bool = False):
        self.values: dict[str, str] = {}
        self.fail_on_set = fail_on_set

    def get(self, reference: str) -> str | None:
        return self.values.get(reference)

    def set(self, reference: str, secret: str) -> None:
        if self.fail_on_set:
            raise RuntimeError("vault_unavailable")
        self.values[reference] = secret

    def delete(self, reference: str) -> None:
        self.values.pop(reference, None)


def _secured_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(
        LocalAuthMiddleware,
        policy=LocalAuthPolicy(
            token="desktop-secret",
            allowed_origins=("http://127.0.0.1:8123",),
            allowed_hosts=("testserver",),
        ),
    )

    @app.get("/private")
    async def private():
        return {"ok": True}

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        await websocket.accept()
        await websocket.send_json({"ok": True})
        await websocket.close()

    return app


def _auth_headers(**extra: str) -> dict[str, str]:
    return {"X-WenShape-Session-Token": "desktop-secret", **extra}


def test_local_auth_denies_http_without_valid_token_origin_and_host():
    client = TestClient(_secured_app())
    assert client.get("/health").status_code == 200
    assert client.get("/private").status_code == 401
    assert client.get("/private", headers={"X-WenShape-Session-Token": "wrong"}).status_code == 401
    assert client.get("/private", headers=_auth_headers(Origin="http://evil.invalid")).status_code == 401
    assert client.get("/private", headers=_auth_headers(Origin="http://127.0.0.1:8123")).json() == {"ok": True}
    assert client.get("/private", headers=_auth_headers(Host="localhost:9999")).status_code == 401


def test_local_auth_denies_websocket_without_token():
    client = TestClient(_secured_app())
    with pytest.raises(WebSocketDisconnect) as error:
        with client.websocket_connect("/ws"):
            pass
    assert error.value.code == 4401

    with client.websocket_connect("/ws", headers=_auth_headers()) as websocket:
        assert websocket.receive_json() == {"ok": True}


def test_plaintext_profiles_migrate_to_vault_and_public_api_is_masked(tmp_path: Path):
    secret = "sk-private-value-1234"
    profiles_path = tmp_path / "llm_profiles.json"
    profiles_path.write_text(
        json.dumps([{"id": "deepseek", "name": "DeepSeek", "provider": "deepseek", "api_key": secret}]),
        encoding="utf-8",
    )
    vault = MemoryVault()

    service = LLMConfigService(str(tmp_path), credential_vault=vault)

    stored_text = profiles_path.read_text(encoding="utf-8")
    assert secret not in stored_text
    assert "api_key" not in json.loads(stored_text)[0]
    assert "secret_ref" in json.loads(stored_text)[0]
    assert service.get_profile_by_id("deepseek")["api_key"] == secret

    public = service.get_public_profiles()[0]
    assert "api_key" not in public
    assert "secret_ref" not in public
    assert public["has_api_key"] is True
    assert public["api_key_mask"] == "****1234"


def test_profile_update_preserves_or_explicitly_clears_secret(tmp_path: Path):
    vault = MemoryVault()
    service = LLMConfigService(str(tmp_path), credential_vault=vault)
    created = service.save_profile(
        {"name": "Provider", "provider": "custom", "model": "m", "api_key": "secret-value"}
    )
    profile_id = created["id"]
    assert created["has_api_key"] is True

    updated = service.save_profile({"id": profile_id, "name": "Renamed", "provider": "custom", "model": "m2"})
    assert updated["has_api_key"] is True
    assert service.get_profile_by_id(profile_id)["api_key"] == "secret-value"

    cleared = service.save_profile(
        {"id": profile_id, "name": "Renamed", "provider": "custom", "model": "m2", "clear_api_key": True}
    )
    assert cleared["has_api_key"] is False
    assert "api_key" not in json.loads((tmp_path / "llm_profiles.json").read_text(encoding="utf-8"))[0]


def test_failed_vault_migration_keeps_plaintext_file_unchanged(tmp_path: Path):
    profiles_path = tmp_path / "llm_profiles.json"
    original = '[{"id":"p","provider":"custom","api_key":"must-survive"}]'
    profiles_path.write_text(original, encoding="utf-8")

    with pytest.raises(RuntimeError, match="vault_unavailable"):
        LLMConfigService(str(tmp_path), credential_vault=MemoryVault(fail_on_set=True))

    assert profiles_path.read_text(encoding="utf-8") == original


def test_logging_formatter_redacts_credentials_and_tracebacks():
    formatter = RedactingFormatter("%(levelname)s %(message)s")
    try:
        raise RuntimeError("authorization: Bearer top-secret-token api_key=sk-secretvalue123456")
    except RuntimeError:
        record = logging.LogRecord(
            "security",
            logging.ERROR,
            __file__,
            1,
            'provider failed with x-wenshape-session-token=session-secret payload={"api_key":"json-secret"}',
            (),
            exc_info=__import__("sys").exc_info(),
        )
    rendered = formatter.format(record)
    assert "top-secret-token" not in rendered
    assert "sk-secretvalue123456" not in rendered
    assert "session-secret" not in rendered
    assert "json-secret" not in rendered
    assert rendered.count("[REDACTED]") >= 4


def test_config_api_and_validation_errors_never_return_secrets():
    from app.main import app

    client = TestClient(app)
    profiles_response = client.get("/config/llm/profiles")
    assert profiles_response.status_code == 200
    for profile in profiles_response.json():
        assert "api_key" not in profile
        assert "secret_ref" not in profile

    secret = "must-not-echo-from-validation"
    invalid = client.post(
        "/config/llm/profiles",
        json={"name": "invalid", "provider": "custom", "api_key": {"secret": secret}},
    )
    assert invalid.status_code == 422
    assert secret not in invalid.text
    assert '"input"' not in invalid.text


# --- V1-2: 监听地址与认证默认值 / listen address and auth defaults ---


def test_default_bind_host_is_loopback():
    """
    默认监听回环地址。

    开发模式下本地认证是条件启用的（无 token 即整体禁用）；若默认监听所有网卡，
    同局域网内任何人都能无认证访问本机数据。需要局域网访问时显式设置 HOST。
    """
    from app.config import Settings

    assert Settings().host == "127.0.0.1"


@pytest.mark.parametrize("host", ["127.0.0.1", "::1", "localhost", ""])
def test_no_warning_when_bound_to_loopback(monkeypatch, host):
    monkeypatch.delenv("WENSHAPE_DESKTOP_SESSION_TOKEN", raising=False)
    monkeypatch.delenv("WENSHAPE_REQUIRE_LOCAL_AUTH", raising=False)
    assert warn_if_exposed_without_auth(host) == ""


def test_no_warning_when_auth_enabled(monkeypatch):
    """绑定 0.0.0.0 本身不危险——只要本地认证已启用。"""
    monkeypatch.setenv("WENSHAPE_DESKTOP_SESSION_TOKEN", "a-real-token")
    monkeypatch.delenv("WENSHAPE_REQUIRE_LOCAL_AUTH", raising=False)
    assert warn_if_exposed_without_auth("0.0.0.0") == ""


def test_warns_when_exposed_without_auth(monkeypatch):
    """非回环 + 无认证：必须告警（但不阻断——局域网联调是正当需求）。"""
    monkeypatch.delenv("WENSHAPE_DESKTOP_SESSION_TOKEN", raising=False)
    monkeypatch.delenv("WENSHAPE_REQUIRE_LOCAL_AUTH", raising=False)
    code = warn_if_exposed_without_auth("0.0.0.0")
    assert code == "insecure_bind_without_local_auth"


def test_require_local_auth_still_hard_fails_without_token(monkeypatch):
    """既有强制机制不变：显式要求认证却无 token 时直接失败，不降级为告警。"""
    monkeypatch.delenv("WENSHAPE_DESKTOP_SESSION_TOKEN", raising=False)
    monkeypatch.setenv("WENSHAPE_REQUIRE_LOCAL_AUTH", "1")
    with pytest.raises(RuntimeError, match="local_auth_token_required"):
        warn_if_exposed_without_auth("0.0.0.0")
