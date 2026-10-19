"""Deploy compiled frontend assets without changing API or MCP routing ownership."""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from starlette.datastructures import Headers
from starlette.exceptions import HTTPException
from starlette.responses import Response
from starlette.routing import Route
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

from mabrid.server.config import ConfigError


class FrontendFiles(StaticFiles):
    """Serve deployment assets with bounded SPA fallback, never a replacement API surface."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        """Override StaticFiles.get_response while retaining its file and traversal checks."""
        parts = Path(path).parts
        if parts and parts[0] in {
            "api",
            "v1",
            "mcp",
            "health",
            "ready",
            "docs",
            "redoc",
            "openapi.json",
        }:
            raise HTTPException(status_code=404)
        try:
            response = await super().get_response(path, scope)
        except HTTPException as exc:
            page = (
                not parts
                or parts == ("status",)
                or (
                    parts[0] in {"gateway", "agent-host"} and all("." not in part for part in parts)
                )
            )
            accept = Headers(scope=scope).get("accept", "*/*")
            if exc.status_code != 404 or not page or not ("text/html" in accept or "*/*" in accept):
                raise
            response = await super().get_response("index.html", scope)
        response.headers["cache-control"] = (
            "public, max-age=31536000, immutable" if parts and parts[0] == "assets" else "no-cache"
        )
        response.headers["x-content-type-options"] = "nosniff"
        response.headers["referrer-policy"] = "no-referrer"
        response.headers["x-frame-options"] = "SAMEORIGIN"
        return response


def mount_frontend(app: FastAPI) -> None:
    """Register an explicit build on frontend paths only, preserving API method errors."""
    selected = os.environ.get("MABRID_FRONTEND_DIST")
    if selected is None:
        return
    directory = Path(selected).resolve()
    if (
        not selected.strip()
        or not (directory / "index.html").is_file()
        or not (directory / "sandbox.html").is_file()
        or not (directory / "assets").is_dir()
    ):
        raise ConfigError(
            "MABRID_FRONTEND_DIST must select a build containing index.html, sandbox.html and assets/."
        )
    files = FrontendFiles(directory=directory)
    for path in (
        "/",
        "/index.html",
        "/sandbox.html",
        "/assets/{path:path}",
        "/gateway",
        "/gateway/{path:path}",
        "/agent-host",
        "/agent-host/{path:path}",
        "/status",
    ):
        app.router.routes.append(
            Route(path, endpoint=files, methods=["GET", "HEAD"], name="frontend")
        )
