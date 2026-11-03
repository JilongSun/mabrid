"""Convert selected file-backed topology into Gateway application definitions."""

from __future__ import annotations

import re

from mabrid.application.gateway.topology import (
    EndpointBinding,
    EndpointDefinition,
    SseConnection,
    StdioConnection,
    StreamableHttpConnection,
    UpstreamConnection,
    UpstreamServerDefinition,
)
from mabrid.bridge import EndpointMode
from pydantic import AnyHttpUrl, TypeAdapter, ValidationError

from mabrid.server.config import (
    RuntimeConfiguration,
    RuntimeTopologyCandidate,
    RuntimeUpstreamConfig,
)

HTTP_URL_ADAPTER = TypeAdapter(AnyHttpUrl)


class TopologyConfigurationError(ValueError):
    """Report a safe candidate-validation error without including connection values."""


def build_topology_definitions(
    configuration: RuntimeConfiguration,
    candidate: RuntimeTopologyCandidate | None = None,
    *,
    allow_unconfigured_host: bool = False,
) -> tuple[list[UpstreamServerDefinition], list[EndpointDefinition]]:
    """Validate identities and construct definitions without touching persistent state."""
    configured_upstreams = candidate.upstreams if candidate is not None else configuration.upstreams
    configured_endpoints = candidate.endpoints if candidate is not None else configuration.endpoints
    upstreams: dict[str, UpstreamServerDefinition] = {}
    seen_upstream_slugs: set[str] = set()
    for name, upstream in configured_upstreams.items():
        slug = _normalize_slug(name)
        if slug in seen_upstream_slugs:
            raise TopologyConfigurationError(f"Multiple upstream names resolve to slug '{slug}'.")
        seen_upstream_slugs.add(slug)
        try:
            upstreams[name] = UpstreamServerDefinition(
                slug=slug,
                display_name=name,
                connection=_to_application_connection(upstream),
                enabled=upstream.enabled,
            )
        except ValidationError as exc:
            raise TopologyConfigurationError(f"Invalid connection for upstream '{name}'.") from exc

    if configuration.diagnostic_upstream is not None:
        selected = upstreams.get(configuration.diagnostic_upstream)
        if selected is None:
            raise TopologyConfigurationError("The diagnostic upstream is not configured.")
        endpoints = [
            EndpointDefinition(
                slug=selected.slug,
                display_name=configuration.bridge.proxy_name or selected.display_name,
                bindings=[EndpointBinding(upstream_server_id=selected.server_id)],
            )
        ]
    else:
        endpoints = []
        seen_endpoint_slugs: set[str] = set()
        for name, endpoint in configured_endpoints.items():
            slug = _normalize_slug(name)
            if slug in seen_endpoint_slugs:
                raise TopologyConfigurationError(
                    f"Multiple endpoint names resolve to slug '{slug}'."
                )
            seen_endpoint_slugs.add(slug)
            try:
                bindings = [
                    EndpointBinding(
                        upstream_server_id=upstreams[binding.upstream].server_id,
                        namespace=binding.namespace,
                        priority=binding.priority,
                        enabled=binding.enabled,
                    )
                    for binding in endpoint.bindings
                ]
                endpoints.append(
                    EndpointDefinition(
                        slug=slug,
                        display_name=endpoint.display_name or name,
                        mode=EndpointMode(endpoint.mode),
                        bindings=bindings,
                        enabled=endpoint.enabled,
                    )
                )
            except KeyError as exc:
                raise TopologyConfigurationError(
                    f"Endpoint '{name}' references an unknown upstream."
                ) from exc
            except ValidationError as exc:
                raise TopologyConfigurationError(
                    f"Invalid bindings for endpoint '{name}'."
                ) from exc

    target_slug = configuration.agent_host.endpoint_slug
    if (
        configuration.agent_host.enabled
        and not (allow_unconfigured_host and not upstreams and not endpoints)
        and not any(endpoint.slug == target_slug and endpoint.enabled for endpoint in endpoints)
    ):
        raise TopologyConfigurationError(
            f"Agent Target '{configuration.agent_host.target_id}' references endpoint "
            f"'{target_slug}', which is not published and enabled."
        )
    enabled_upstreams = {upstream.server_id for upstream in upstreams.values() if upstream.enabled}
    for endpoint in endpoints:
        if endpoint.enabled and any(
            binding.enabled and binding.upstream_server_id not in enabled_upstreams
            for binding in endpoint.bindings
        ):
            raise TopologyConfigurationError(
                f"Enabled endpoint '{endpoint.slug}' references a disabled upstream."
            )
    return list(upstreams.values()), endpoints


def _to_application_connection(upstream: RuntimeUpstreamConfig) -> UpstreamConnection:
    if upstream.transport == "streamable-http":
        if upstream.url is None:
            raise TopologyConfigurationError("A streamable HTTP upstream requires a URL.")
        return StreamableHttpConnection(
            url=HTTP_URL_ADAPTER.validate_python(upstream.url),
            headers=upstream.headers,
            timeout_seconds=upstream.httpx_timeout_seconds or 30.0,
        )
    if upstream.transport == "sse":
        if upstream.url is None:
            raise TopologyConfigurationError("An SSE upstream requires a URL.")
        return SseConnection(
            url=HTTP_URL_ADAPTER.validate_python(upstream.url),
            headers=upstream.headers,
        )
    if upstream.command is None:
        raise TopologyConfigurationError("A stdio upstream requires a command.")
    return StdioConnection(
        command=upstream.command,
        args=upstream.args,
        cwd=upstream.cwd,
        env=upstream.env,
    )


def _normalize_slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9-]+", "-", value.lower()).strip("-")
    if not slug or not slug[0].isalpha():
        return f"server-{slug}" if slug else "server"
    return slug
