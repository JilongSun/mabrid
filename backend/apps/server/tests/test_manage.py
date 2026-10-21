from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[4]
SHELL_DOCKER = """#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_TEST_LOG"
case "$*" in
  'info --format '*) printf 'linux\\n' ;;
    'compose version '*)
        if [ "$DOCKER_TEST_SCENARIO" = old-compose ]; then printf '2.29.0\\n'; else printf '2.30.0\\n'; fi ;;
  'image inspect '*)
    [ "$DOCKER_TEST_SCENARIO" != image ] || exit 1
    printf 'linux\\n' ;;
  'container ls '*|'volume ls '*)
    [ "$DOCKER_TEST_SCENARIO" != foreign ] || printf 'mabrid\\n' ;;
  'container inspect '*Labels*) printf 'foreign-owner\\n' ;;
  'container inspect '*ExitCode*) printf '0\\n' ;;
  'logs '*) printf 'Application shutdown complete.\\n' >&2 ;;
  'compose '*)
    case "$*" in
      *' ps --status running '*)
        case "$DOCKER_TEST_SCENARIO" in active|stop) printf 'fixture-id\\n' ;; esac ;;
            *' up --detach '*) [ "$DOCKER_TEST_SCENARIO" != start ] || exit 1 ;;
    esac ;;
esac
exit 0
"""
POWERSHELL_DOCKER = r"""
function global:docker {
    $global:LASTEXITCODE = 0
    $line = $args -join ' '
    [IO.File]::AppendAllText($env:DOCKER_TEST_LOG, $line + [Environment]::NewLine)
    if ($line.StartsWith('info --format')) { 'linux' }
    elseif ($line.StartsWith('compose version')) {
        if ($env:DOCKER_TEST_SCENARIO -eq 'old-compose') { '2.29.0' } else { '2.30.0' }
    }
    elseif ($line.StartsWith('image inspect')) {
        if ($env:DOCKER_TEST_SCENARIO -eq 'image') { $global:LASTEXITCODE = 1 }
        else { 'linux' }
    }
    elseif ($line.StartsWith('container ls') -or $line.StartsWith('volume ls')) {
        if ($env:DOCKER_TEST_SCENARIO -eq 'foreign') { 'mabrid' }
    }
    elseif ($line.StartsWith('container inspect') -and $line.Contains('Labels')) {
        '{"io.mabrid.config-directory":"foreign-owner"}'
    }
    elseif ($line.StartsWith('container inspect') -and $line.Contains('ExitCode')) { '0' }
    elseif ($line.StartsWith('logs ')) { 'Application shutdown complete.' }
    elseif ($line.StartsWith('compose ')) {
        if ($line.Contains(' ps --status running ')) {
            if ($env:DOCKER_TEST_SCENARIO -in @('active', 'stop')) { 'fixture-id' }
        }
        elseif ($line.Contains(' up --detach ') -and $env:DOCKER_TEST_SCENARIO -eq 'start') {
            $global:LASTEXITCODE = 1
        }
    }
}
"""


def windows_path(path: Path, executable: str) -> str:
    if os.name != "nt" and executable.lower().endswith(".exe"):
        return subprocess.run(
            ["wslpath", "-w", str(path)], check=True, capture_output=True, text=True
        ).stdout.strip()
    return str(path)


@pytest.fixture(params=["unix", "windows"])
def launcher(request: pytest.FixtureRequest, tmp_path: Path):
    directory = tmp_path / "configuration with spaces"
    environment = os.environ.copy()
    environment["DOCKER_TEST_SCENARIO"] = "success"
    if request.param == "unix":
        shell = shutil.which("sh")
        if shell is None:
            pytest.skip("POSIX shell is unavailable")
        binaries = tmp_path / "bin"
        binaries.mkdir()
        for utility in ("dirname", "mkdir", "cp", "grep"):
            executable = shutil.which(utility)
            assert executable is not None
            (binaries / utility).symlink_to(executable)
        docker = binaries / "docker"
        docker.write_text(SHELL_DOCKER, encoding="utf-8")
        docker.chmod(0o755)
        environment["PATH"] = str(binaries)
        log = tmp_path / "docker.log"
        environment["DOCKER_TEST_LOG"] = str(log)
        base = [shell, str(ROOT / "scripts/manage.sh")]

        def invoke(action: str, scenario: str = "success") -> subprocess.CompletedProcess[str]:
            environment["DOCKER_TEST_SCENARIO"] = scenario
            return subprocess.run(
                [*base, action, "--config-dir", str(directory)],
                env=environment,
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )

    else:
        executable = shutil.which("powershell.exe") or shutil.which("pwsh")
        if executable is None:
            pytest.skip("PowerShell is unavailable")
        log = tmp_path / "docker.log"
        environment["DOCKER_TEST_LOG"] = windows_path(log, executable)
        script = windows_path(ROOT / "scripts/manage.ps1", executable).replace("'", "''")
        config = windows_path(directory, executable).replace("'", "''")

        def invoke(action: str, scenario: str = "success") -> subprocess.CompletedProcess[str]:
            environment["DOCKER_TEST_SCENARIO"] = scenario
            native_log = windows_path(log, executable).replace("'", "''")
            command = (
                "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); "
                + f"$env:DOCKER_TEST_LOG = '{native_log}'; "
                + f"$env:DOCKER_TEST_SCENARIO = '{scenario}'; "
                + POWERSHELL_DOCKER
                + f"\n& '{script}' {action} -ConfigDir '{config}'; exit $LASTEXITCODE"
            )
            return subprocess.run(
                [
                    executable,
                    "-NoLogo",
                    "-NoProfile",
                    "-NonInteractive",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    command,
                ],
                env=environment,
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )

    return invoke, directory, log


def test_native_setup_is_idempotent_without_host_python(launcher) -> None:
    invoke, directory, log = launcher
    result = invoke("setup")
    assert result.returncode == 0, result.stderr
    assert (directory / "mabrid.yaml").read_bytes() == (ROOT / "mabrid.yaml.example").read_bytes()
    env_file = directory / ".env"
    assert env_file.is_file()
    assert "API_SERVER_KEY" in env_file.read_text(encoding="utf-8")
    (directory / "mabrid.yaml").write_bytes(b"user-owned configuration\n")
    (directory / ".env").write_bytes(b"USER_VALUE=fixture-only\n")
    result = invoke("setup")
    assert result.returncode == 0, result.stderr
    assert (directory / "mabrid.yaml").read_bytes() == b"user-owned configuration\n"
    assert (directory / ".env").read_bytes() == b"USER_VALUE=fixture-only\n"
    assert not log.exists()


@pytest.mark.parametrize("action", ["build", "run", "recreate"])
def test_missing_setup_never_contacts_docker(launcher, action: str) -> None:
    invoke, _, log = launcher
    result = invoke(action)
    assert result.returncode != 0
    assert "setup first" in result.stderr.lower()
    assert not log.exists()


@pytest.mark.parametrize("action", ["build", "run", "stop"])
def test_native_docker_workflow(launcher, action: str) -> None:
    invoke, _, log = launcher
    assert invoke("setup").returncode == 0
    result = invoke(action, "stop" if action == "stop" else "success")
    assert result.returncode == 0, result.stderr
    commands = log.read_text(encoding="utf-8")
    if action == "build":
        assert " build mabrid" in commands
        assert " preflight" not in commands
    elif action == "run":
        assert " run --rm" not in commands
        assert " up --detach" in commands
        assert "--no-build --pull never mabrid" in commands
        assert "--wait" in commands
        assert "readiness is not checked" in result.stdout
    else:
        assert " stop --timeout 20 mabrid" in commands
        assert "volume rm" not in commands
        assert " down" not in commands


def test_native_recreate_gracefully_replaces_running_container(launcher) -> None:
    invoke, _, log = launcher
    assert invoke("setup").returncode == 0
    result = invoke("recreate", "stop")
    assert result.returncode == 0, result.stderr
    commands = log.read_text(encoding="utf-8")
    assert "image inspect" in commands
    assert " stop --timeout 20 mabrid" in commands
    assert " up --detach" in commands
    assert "--force-recreate --no-build --pull never mabrid" in commands
    assert "volume rm" not in commands
    assert "Recreated mabrid" in result.stdout
    assert "mabrid-data is preserved" in result.stdout


def test_native_recreate_without_running_container_skips_stop(launcher) -> None:
    invoke, _, log = launcher
    assert invoke("setup").returncode == 0
    result = invoke("recreate", "success")
    assert result.returncode == 0, result.stderr
    commands = log.read_text(encoding="utf-8")
    assert " stop --timeout" not in commands
    assert "--force-recreate --no-build --pull never mabrid" in commands


@pytest.mark.parametrize("scenario", ["image", "foreign", "old-compose"])
def test_recreate_prerequisites_never_start_containers(launcher, scenario: str) -> None:
    invoke, _, log = launcher
    assert invoke("setup").returncode == 0
    result = invoke("recreate", scenario)
    assert result.returncode != 0
    assert " up --detach" not in log.read_text(encoding="utf-8")


@pytest.mark.parametrize("scenario", ["image", "foreign", "active", "start", "old-compose"])
def test_failed_prerequisites_do_not_claim_success(launcher, scenario: str) -> None:
    invoke, _, log = launcher
    assert invoke("setup").returncode == 0
    result = invoke("run", scenario)
    assert result.returncode != 0
    commands = log.read_text(encoding="utf-8")
    if scenario != "start":
        assert " up --detach" not in commands


def test_compose_keeps_secrets_runtime_only() -> None:
    document = yaml.safe_load((ROOT / "compose.yaml").read_text(encoding="utf-8"))
    service = document["services"]["mabrid"]
    assert list(document["services"]) == ["mabrid"]
    assert service["env_file"][0]["format"] == "raw"
    assert service["env_file"][0]["required"] is False
    assert "args" not in service["build"]
    configuration = service["volumes"][1]
    assert configuration["source"] == "${MABRID_CONFIG_DIR}/mabrid.yaml"
    assert configuration["target"] == "/var/lib/mabrid/mabrid.yaml"
    assert configuration["read_only"]


def test_root_example_matches_current_configuration_contract() -> None:
    from mabrid.server.config import load_bridge_config

    loaded = load_bridge_config(str(ROOT / "mabrid.yaml.example"))
    assert loaded.config.bridge.api_port == 8765
    assert loaded.config.storage.sqlite_path == Path("backend/var/mabrid.db")
