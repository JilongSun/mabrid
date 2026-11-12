"""Read-only product capabilities; remote Host status never changes local readiness."""

from typing import Literal

from fastapi import APIRouter, Response

from mabrid.application.agent_host import AgentHostCapabilityService, AgentHostCapabilitySnapshot
from mabrid.server.composition.host_runtime import AgentHostRuntime

from .host_contracts import HostHttpModel


class GatewayCapabilities(HostHttpModel):
    """Report implemented Gateway read/inspection features and explicit mutation absence."""

    enabled: Literal[True] = True
    topology_read: bool
    session_inspection: bool
    topology_mutation: Literal[False] = False
    mcp_apps_protocol_passthrough: Literal[True] = True


class ProductCapabilitiesResponse(HostHttpModel):
    """Combine independent Gateway and Agent Host capability/availability views."""

    gateway: GatewayCapabilities
    agent_host: AgentHostCapabilitySnapshot


def create_capabilities_router(
    service: AgentHostCapabilityService,
    *,
    management_enabled: bool,
    runtime: AgentHostRuntime | None = None,
) -> APIRouter:
    router = APIRouter(tags=["Capabilities"])

    @router.get("/api/v1/capabilities", response_model=ProductCapabilitiesResponse)
    async def capabilities(response: Response) -> ProductCapabilitiesResponse:
        response.headers["Cache-Control"] = "no-store"
        active = service
        if runtime is not None:
            current = runtime.current
            active = current.capability_service if current else AgentHostCapabilityService()
        return ProductCapabilitiesResponse(
            gateway=GatewayCapabilities(
                topology_read=management_enabled, session_inspection=management_enabled
            ),
            agent_host=await active.snapshot(),
        )

    return router
