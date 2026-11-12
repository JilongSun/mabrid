"""Agent Host reads and trusted-deployment-only configuration commands."""

from __future__ import annotations

from fastapi import APIRouter

from mabrid.server.composition import AgentHostManagementView
from mabrid.server.composition.host_runtime import AgentHostRuntime
from mabrid.server.composition.configuration import (
    ConfigurationApplyError,
    RuntimeConfigurationManager,
)
from mabrid.server.composition.topology import TopologyConfigurationError
from mabrid.server.config.editor import (
    ConfigurationEditError,
    HostRuntimeEditRequest,
    HostRuntimeEditView,
)

from .dto import AgentTargetResponse, ApplyGatewayConfigurationRequest, HostConfigurationResponse
from .errors import ManagementProblem, problem, problem_responses


def create_agent_host_management_router(
    management: AgentHostManagementView | None,
    *,
    runtime: AgentHostRuntime | None = None,
    configuration: RuntimeConfigurationManager | None = None,
) -> APIRouter:
    router = APIRouter(
        prefix="/api/v1/agent-host",
        tags=["agent-host-management"],
        responses=problem_responses(404, 422),
    )

    def manager() -> RuntimeConfigurationManager:
        if configuration is None:
            raise ManagementProblem(
                problem(
                    code="configuration_unavailable",
                    title="Configuration unavailable",
                    status=503,
                    detail="File-backed Host configuration is unavailable.",
                )
            )
        return configuration

    def configuration_error(code: str, detail: str) -> ManagementProblem:
        status = {
            "configuration_conflict": 409,
            "configuration_busy": 409,
            "configuration_invalid": 422,
            "configuration_file_error": 503,
            "configuration_host_error": 503,
        }.get(code, 503)
        return ManagementProblem(
            problem(
                code=code,
                title="Host configuration failed",
                status=status,
                detail=detail,
            )
        )

    @router.get(
        "/configuration",
        response_model=HostConfigurationResponse,
        responses=problem_responses(503),
    )
    async def get_configuration() -> HostConfigurationResponse:
        return HostConfigurationResponse.model_validate(
            await manager().host_status(), from_attributes=True
        )

    @router.get(
        "/configuration/runtime",
        response_model=HostRuntimeEditView,
        responses=problem_responses(503),
    )
    async def read_configuration() -> HostRuntimeEditView:
        try:
            return await manager().read_host_runtime()
        except ConfigurationEditError as exc:
            raise configuration_error(exc.code, str(exc)) from exc

    @router.put(
        "/configuration/runtime",
        response_model=HostRuntimeEditView,
        responses=problem_responses(409, 503),
    )
    async def save_configuration(request: HostRuntimeEditRequest) -> HostRuntimeEditView:
        try:
            return await manager().save_host_runtime(request)
        except ConfigurationEditError as exc:
            raise configuration_error(exc.code, str(exc)) from exc
        except TopologyConfigurationError as exc:
            raise configuration_error("configuration_invalid", str(exc)) from exc

    @router.post(
        "/configuration/apply",
        response_model=HostConfigurationResponse,
        responses=problem_responses(409, 503),
    )
    async def apply_configuration(
        request: ApplyGatewayConfigurationRequest,
    ) -> HostConfigurationResponse:
        try:
            status = await manager().apply_host(request.expected_hash)
        except ConfigurationApplyError as exc:
            raise configuration_error(exc.code, str(exc)) from exc
        return HostConfigurationResponse.model_validate(status, from_attributes=True)

    @router.get("/target", response_model=AgentTargetResponse)
    async def get_target() -> AgentTargetResponse:
        active = management
        if runtime is not None:
            current = runtime.current
            active = current.management if current is not None else None
        if active is None:
            raise ManagementProblem(
                problem(
                    code="agent_host_disabled",
                    title="Agent Host disabled",
                    status=404,
                    detail="The Agent Host is not enabled for this deployment.",
                )
            )
        return AgentTargetResponse.from_view(active)

    return router
