from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator
from socket import socket
from unittest.mock import Mock
from uuid import uuid4

import anyio
import httpx
import pytest
import uvicorn
from fastapi import FastAPI
from starlette.responses import StreamingResponse

from mabrid.application.agent_host import (
    RuntimeRunHandle,
    RuntimeSessionRunStarted,
    StartSessionRunCommand,
)
from mabrid.application.host import HostSessionEventStream
from mabrid.server.api.host import create_host_router
import mabrid.server.runtime.server as runtime_module
from mabrid.server.runtime.server import MabridServerRuntime


@pytest.mark.parametrize("request_kind", ["ordinary", "compatibility_stream", "host_admission"])
async def test_sigterm_bounds_long_request_and_runs_application_shutdown(
    monkeypatch: pytest.MonkeyPatch, request_kind: str
) -> None:
    monkeypatch.setattr(runtime_module, "_GRACEFUL_REQUEST_SHUTDOWN_TIMEOUT_SECONDS", 0.1)
    request_entered = anyio.Event()
    request_cancelled = anyio.Event()
    application_shutdown = anyio.Event()
    hold_request = anyio.Event()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        try:
            yield
        finally:
            application_shutdown.set()

    app = FastAPI(lifespan=lifespan)

    if request_kind == "ordinary":

        @app.get("/hold")
        async def hold() -> dict[str, str]:
            request_entered.set()
            try:
                await hold_request.wait()
            finally:
                request_cancelled.set()
            return {"state": "released"}

    elif request_kind == "compatibility_stream":

        @app.get("/hold")
        async def compatibility_stream() -> StreamingResponse:
            async def chunks() -> AsyncGenerator[bytes, None]:
                request_entered.set()
                try:
                    await hold_request.wait()
                    yield b"data: pending\n\n"
                finally:
                    request_cancelled.set()

            return StreamingResponse(chunks(), media_type="text/event-stream")

    else:

        class PendingSessionRuns:
            target_id = "fixture-target"

            async def run_session(
                self, command: StartSessionRunCommand
            ) -> AsyncGenerator[RuntimeSessionRunStarted, None]:
                del command
                request_entered.set()
                try:
                    await hold_request.wait()
                    yield RuntimeSessionRunStarted(
                        handle=RuntimeRunHandle(
                            runtime_binding_id="fixture-deployment",
                            remote_run_id="fixture-run",
                        )
                    )
                finally:
                    request_cancelled.set()

        app.include_router(create_host_router(Mock(), HostSessionEventStream(PendingSessionRuns())))

    monkeypatch.setattr(runtime_module, "create_app", lambda *_args, **_kwargs: app)
    original_serve = uvicorn.Server.serve
    servers: list[uvicorn.Server] = []

    async def capture_serve(server: uvicorn.Server, sockets: list[socket] | None = None) -> None:
        servers.append(server)
        await original_serve(server, sockets)

    monkeypatch.setattr(uvicorn.Server, "serve", capture_serve)
    runtime = MabridServerRuntime(Mock(), api_host="127.0.0.1", api_port=0)

    async with httpx.AsyncClient(timeout=None) as client:
        async with anyio.create_task_group() as tasks:
            tasks.start_soon(runtime.serve)
            with anyio.fail_after(2):
                while not servers or not servers[0].started:
                    await anyio.sleep(0.01)

            server = servers[0]
            assert server.config.timeout_graceful_shutdown == 0.1
            port = server.servers[0].sockets[0].getsockname()[1]

            async def issue_request() -> None:
                try:
                    if request_kind == "host_admission":
                        await client.post(
                            f"http://127.0.0.1:{port}/api/v1/host/sessions/{uuid4()}/runs",
                            json={"input_text": "fixture"},
                        )
                    else:
                        await client.get(f"http://127.0.0.1:{port}/hold")
                except httpx.HTTPError:
                    pass

            tasks.start_soon(issue_request)
            with anyio.fail_after(2):
                await request_entered.wait()
            server.should_exit = True

            with anyio.fail_after(2):
                await request_cancelled.wait()
                await application_shutdown.wait()
