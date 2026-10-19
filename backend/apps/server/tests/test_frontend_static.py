from __future__ import annotations

from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI

from mabrid.server.api.frontend import mount_frontend
from mabrid.server.config import ConfigError


@pytest.fixture
def frontend(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    directory = tmp_path / "dist"
    directory.mkdir()
    (directory / "index.html").write_text("<html>Host</html>", encoding="utf-8")
    (directory / "sandbox.html").write_text("<html>Sandbox</html>", encoding="utf-8")
    (directory / "assets").mkdir()
    (directory / "assets" / "main-12345678.js").write_text("export {};", encoding="utf-8")
    (directory / "assets" / "main-12345678.css").write_text("body {}", encoding="utf-8")
    (directory / "api").mkdir()
    (directory / "api" / "private.txt").write_text("must not be served", encoding="utf-8")
    monkeypatch.setenv("MABRID_FRONTEND_DIST", str(directory))
    return directory


def application() -> FastAPI:
    app = FastAPI()

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/v1/probe")
    async def probe() -> dict[str, bool]:
        return {"available": True}

    mount_frontend(app)
    return app


@pytest.mark.parametrize(
    "path",
    [
        "/",
        "/gateway/topology",
        "/gateway/endpoints/example",
        "/agent-host",
        "/agent-host/sessions/example",
        "/status",
    ],
)
async def test_spa_pages_and_head_use_the_main_entry(frontend: Path, path: str) -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=application()), base_url="http://test"
    ) as client:
        response = await client.get(path)
        assert response.status_code == 200
        assert response.text == "<html>Host</html>"
        assert response.headers["content-type"].startswith("text/html")
        assert response.headers["cache-control"] == "no-cache"
        assert response.headers["x-content-type-options"] == "nosniff"
        head = await client.head(path)
        assert head.status_code == 200 and head.content == b""
        assert head.headers["content-length"] == response.headers["content-length"]


async def test_sandbox_and_versioned_assets_are_not_spa_fallbacks(frontend: Path) -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=application()), base_url="http://test"
    ) as client:
        sandbox = await client.get("/sandbox.html")
        assert sandbox.text == "<html>Sandbox</html>"
        assert sandbox.headers["cache-control"] == "no-cache"
        assert sandbox.headers["x-frame-options"] == "SAMEORIGIN"
        for name, mime in [("main-12345678.js", "javascript"), ("main-12345678.css", "text/css")]:
            asset = await client.get(f"/assets/{name}")
            assert asset.status_code == 200 and mime in asset.headers["content-type"]
            assert asset.headers["cache-control"] == "public, max-age=31536000, immutable"
        assert (await client.get("/health")).json() == {"status": "ok"}
        assert (await client.get("/api/v1/probe")).json() == {"available": True}


@pytest.mark.parametrize(
    "path",
    [
        "/api/missing",
        "/api/private.txt",
        "/v1/missing",
        "/mcp/missing",
        "/ready",
        "/assets/missing.js",
        "/gateway/missing.js",
        "/missing.html",
        "/unknown",
        "/%2e%2e/private.txt",
    ],
)
async def test_unknown_api_assets_and_traversal_do_not_return_html(
    frontend: Path, path: str
) -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=application()), base_url="http://test"
    ) as client:
        response = await client.get(path)
        assert response.status_code == 404
        assert "Host" not in response.text and "must not be served" not in response.text


async def test_non_navigation_and_post_requests_do_not_receive_spa_html(frontend: Path) -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=application()), base_url="http://test"
    ) as client:
        assert (
            await client.get("/gateway/topology", headers={"accept": "application/json"})
        ).status_code == 404
        assert (await client.post("/agent-host")).status_code == 405


@pytest.mark.parametrize("path", ["/health", "/api/v1/probe"])
async def test_existing_api_method_errors_remain_405(frontend: Path, path: str) -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=application()), base_url="http://test"
    ) as client:
        for method in ["POST", "HEAD", "DELETE"]:
            response = await client.request(method, path)
            assert response.status_code == 405
            assert response.headers["allow"] == "GET"


async def test_api_only_is_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MABRID_FRONTEND_DIST", raising=False)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=application()), base_url="http://test"
    ) as client:
        for path in ("/", "/sandbox.html", "/assets/main-12345678.js"):
            assert (await client.get(path)).status_code == 404
        assert (await client.get("/health")).json() == {"status": "ok"}


@pytest.mark.parametrize("missing", ["index.html", "sandbox.html", "assets"])
def test_incomplete_build_is_a_configuration_error(frontend: Path, missing: str) -> None:
    path = frontend / missing
    if path.is_dir():
        for child in path.iterdir():
            child.unlink()
        path.rmdir()
    else:
        path.unlink()
    with pytest.raises(ConfigError, match="MABRID_FRONTEND_DIST"):
        application()


def test_blank_or_nonexistent_directory_is_not_silently_disabled(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    for value in ["", " ", str(tmp_path / "missing")]:
        monkeypatch.setenv("MABRID_FRONTEND_DIST", value)
        with pytest.raises(ConfigError, match="MABRID_FRONTEND_DIST"):
            application()
