"""Inbound OpenAI-compatible HTTP adapter for the Agent Host application."""

from __future__ import annotations

from collections.abc import AsyncGenerator, Iterable, Mapping
from contextlib import aclosing
from datetime import datetime, timezone
from typing import Any, cast
from uuid import uuid4

from fastapi import APIRouter, Body
from mabrid.application.agent_host import (
    AgentHostService,
    AgentMessage,
    AgentRunError,
    AgentRunCompleted,
    AgentRunFailed,
    AgentRunStarted,
    AssistantTextDelta,
    GenerationOptions,
    StartRunCommand,
)
from mabrid.application.host import HostAgentEvent, HostEventStream
from mabrid.server.composition.host_runtime import AgentHostRuntime
from openai.pagination import AsyncPage
from openai.types import Model
from openai.types.chat import ChatCompletion, ChatCompletionMessage
from openai.types.chat.chat_completion import Choice
from openai.types.chat.chat_completion_chunk import (
    ChatCompletionChunk,
    Choice as ChunkChoice,
    ChoiceDelta,
)
from openai.types.chat.completion_create_params import CompletionCreateParams
from openai.types.completion_usage import CompletionUsage
from starlette.responses import JSONResponse, Response, StreamingResponse


def create_openai_compatibility_router(
    agent_host: AgentHostService | None,
    host_events: HostEventStream | None = None,
    *,
    runtime: AgentHostRuntime | None = None,
) -> APIRouter:
    router = APIRouter(prefix="/v1")

    def services() -> tuple[AgentHostService | None, HostEventStream | None]:
        if runtime is not None:
            current = runtime.current
            return (
                current.service if current is not None else None,
                current.capabilities.events if current is not None else None,
            )
        return agent_host, host_events or (HostEventStream(agent_host) if agent_host else None)

    @router.get("/models")
    async def list_models() -> JSONResponse:
        agent_host, _ = services()
        if agent_host is None:
            return _error_response(
                "Agent Host is unavailable.", status_code=503, error_type="api_error"
            )
        models = await agent_host.list_models()
        response = AsyncPage[Model](
            object="list",
            data=[
                Model(
                    id=model.model_id,
                    created=_timestamp(model.created_at),
                    object="model",
                    owned_by=model.owned_by,
                )
                for model in models
            ],
        )
        return JSONResponse(response.model_dump(mode="json", exclude_none=True))

    @router.post("/chat/completions")
    async def create_chat_completion(
        payload: CompletionCreateParams = Body(
            ...,
            openapi_examples={
                "basic": {
                    "summary": "Basic text completion",
                    "value": {
                        "model": agent_host.target.target_id if agent_host is not None else "agent",
                        "messages": [{"role": "user", "content": "Hello"}],
                        "stream": False,
                    },
                }
            },
        ),
    ) -> Response:
        agent_host, event_stream = services()
        if agent_host is None or event_stream is None:
            return _error_response(
                "Agent Host is unavailable.", status_code=503, error_type="api_error"
            )
        try:
            command = _to_start_run_command(payload)
        except (TypeError, ValueError) as exc:
            return _error_response(str(exc), status_code=422, error_type="invalid_request_error")

        if payload.get("stream") is True:
            stream_options = payload.get("stream_options") or {}
            return StreamingResponse(
                _stream_chat_completion(
                    event_stream,
                    command,
                    model=agent_host.target.target_id,
                    include_usage=stream_options.get("include_usage") is True,
                ),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache"},
            )

        try:
            result = await agent_host.complete(command)
        except AgentRunError as exc:
            return _error_response(str(exc), status_code=502, error_type="api_error")

        completion = ChatCompletion(
            id=f"chatcmpl-{result.run_id.hex}",
            choices=[
                Choice(
                    finish_reason=result.finish_reason,
                    index=0,
                    message=ChatCompletionMessage(
                        role="assistant",
                        content=result.output_text,
                    ),
                )
            ],
            created=int(datetime.now(timezone.utc).timestamp()),
            model=result.model,
            object="chat.completion",
            usage=CompletionUsage(
                completion_tokens=result.usage.output_tokens,
                prompt_tokens=result.usage.input_tokens,
                total_tokens=result.usage.total_tokens,
            ),
        )
        return JSONResponse(completion.model_dump(mode="json", exclude_none=True))

    return router


async def _stream_chat_completion(
    host_events: HostEventStream,
    command: StartRunCommand,
    *,
    model: str,
    include_usage: bool,
) -> AsyncGenerator[str, None]:
    completion_id = f"chatcmpl-{command.run_id.hex}"
    created = int(datetime.now(timezone.utc).timestamp())

    def chunk(choices: list[ChunkChoice], usage: CompletionUsage | None = None) -> str:
        return (
            "data: "
            + ChatCompletionChunk(
                id=completion_id,
                choices=choices,
                created=created,
                model=model,
                object="chat.completion.chunk",
                usage=usage,
            ).model_dump_json(exclude_none=True)
            + "\n\n"
        )

    async with aclosing(host_events.run_events(command)) as events:
        async for envelope in events:
            if not isinstance(envelope, HostAgentEvent):
                continue
            event = envelope.event
            if isinstance(event, AgentRunStarted):
                yield chunk([ChunkChoice(index=0, delta=ChoiceDelta(role="assistant"))])
            elif isinstance(event, AssistantTextDelta):
                yield chunk([ChunkChoice(index=0, delta=ChoiceDelta(content=event.delta))])
            elif isinstance(event, AgentRunCompleted):
                yield chunk(
                    [
                        ChunkChoice(
                            index=0,
                            delta=ChoiceDelta(),
                            finish_reason=event.result.finish_reason,
                        )
                    ]
                )
                if include_usage:
                    usage = event.result.usage
                    yield chunk(
                        [],
                        CompletionUsage(
                            completion_tokens=usage.output_tokens,
                            prompt_tokens=usage.input_tokens,
                            total_tokens=usage.total_tokens,
                        ),
                    )
                yield "data: [DONE]\n\n"
                return
            elif isinstance(event, AgentRunFailed):
                error = _error_response(
                    event.error_message,
                    status_code=502,
                    error_type="api_error",
                )
                yield "data: " + bytes(error.body).decode("utf-8") + "\n\n"
                return


def _to_start_run_command(payload: Mapping[str, Any]) -> StartRunCommand:
    raw_messages = cast(Iterable[Mapping[str, Any]], payload["messages"])
    messages: list[AgentMessage] = []
    for message in raw_messages:
        role = message.get("role")
        content = message.get("content")
        if role == "tool":
            raise ValueError("Tool messages are not supported in this release")
        if role not in {"developer", "system", "user", "assistant"}:
            raise ValueError(f"Unsupported chat message role: {role}")
        if not isinstance(content, str):
            raise ValueError("Only text message content is supported in this release")
        name = message.get("name")
        messages.append(
            AgentMessage(
                role=role,
                content=content,
                name=name if isinstance(name, str) else None,
            )
        )

    max_output_tokens = payload.get("max_completion_tokens") or payload.get("max_tokens")
    temperature = payload.get("temperature")
    return StartRunCommand(
        run_id=uuid4(),
        model=str(payload["model"]),
        messages=tuple(messages),
        options=GenerationOptions(
            temperature=float(temperature) if temperature is not None else None,
            max_output_tokens=int(max_output_tokens) if max_output_tokens is not None else None,
        ),
    )


def _timestamp(value: datetime | None) -> int:
    return int(value.timestamp()) if value is not None else 0


def _error_response(
    message: str,
    *,
    status_code: int,
    error_type: str,
    param: str | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "message": message,
                "type": error_type,
                "param": param,
                "code": None,
            }
        },
    )
